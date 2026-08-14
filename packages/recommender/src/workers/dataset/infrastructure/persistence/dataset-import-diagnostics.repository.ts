import type { Client } from '@libsql/client';
import type {
  DatasetDiagnosticCategory,
  DatasetDiagnosticSummary,
  DatasetDiagnosticsPage,
  DatasetDiagnosticsPagination,
  DatasetFailure,
  DatasetFailureReason,
  DatasetFileType,
  DatasetImportDiagnostic,
  DatasetImportDiagnosticInput,
} from '../../domain/dataset-import-queue.types.js';

const DIAGNOSTIC_BATCH_SIZE = 100;
const MAX_FIELD_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 512;
export const MAX_PERSISTED_DIAGNOSTICS = 5_000;
const MAX_SUMMARY_BUCKETS = 1_000;
const MAX_VALUE_PREVIEW_LENGTH = 160;

const FAILURE_MESSAGES: Record<DatasetFailureReason, string> = {
  duplicate_value: 'Valores duplicados ou conflitantes foram ignorados.',
  invalid_encoding: 'O arquivo nao esta codificado em UTF-8 valido.',
  invalid_field: 'Campos invalidos foram encontrados.',
  invalid_header: 'O cabecalho CSV e invalido.',
  invalid_row: 'Linhas CSV invalidas foram encontradas.',
  link_not_found: 'Vinculos MovieLens referenciados nao foram encontrados.',
  movie_not_found: 'Filmes referenciados nao foram encontrados.',
};

const SAFE_VALUE_FIELDS = new Set([
  'adult',
  'belongs_to_collection.id',
  'budget',
  'cast[].cast_id',
  'cast[].gender',
  'cast[].id',
  'cast[].order',
  'crew[].gender',
  'crew[].id',
  'genres[].id',
  'id',
  'imdb_id',
  'imdbId',
  'movieId',
  'original_language',
  'popularity',
  'production_companies[].id',
  'production_countries[].iso_3166_1',
  'rating',
  'release_date',
  'revenue',
  'runtime',
  'spoken_languages[].iso_639_1',
  'timestamp',
  'tmdbId',
  'video',
  'vote_average',
  'vote_count',
]);

export interface DatasetImportDiagnosticsCollector {
  failures(): DatasetFailure[];
  flush(): Promise<void>;
  record(diagnostic: DatasetImportDiagnosticInput): Promise<void>;
}

interface SummaryBucket {
  category: DatasetDiagnosticCategory;
  count: number;
  field: string;
  reason: DatasetFailureReason;
  ruleCode: string;
}

export function createDatasetImportDiagnosticsCollector(client: Client, uploadId: string): DatasetImportDiagnosticsCollector {
  const countsByReason = new Map<DatasetFailureReason, number>();
  const pendingDiagnostics: DatasetImportDiagnosticInput[] = [];
  const summaryBuckets = new Map<string, SummaryBucket>();
  let diagnosticCount = 0;
  let pendingCount = 0;

  async function flush(): Promise<void> {
    if (pendingDiagnostics.length === 0 && summaryBuckets.size === 0) {
      return;
    }

    const diagnostics = [...pendingDiagnostics];
    const summaries = [...summaryBuckets.values()];
    const statements = [
      ...diagnostics.map((diagnostic) => ({
        sql: 'INSERT INTO dataset_import_diagnostics (id, upload_id, line_start, line_end, field_name, value_preview, diagnostic_category, reason, rule_code, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
          crypto.randomUUID(),
          uploadId,
          diagnostic.lineStart,
          diagnostic.lineEnd,
          sanitizeField(diagnostic.field),
          previewValue(diagnostic.field, diagnostic.value),
          diagnostic.category,
          diagnostic.reason,
          limitText(diagnostic.ruleCode, MAX_FIELD_LENGTH),
          limitText(diagnostic.message, MAX_MESSAGE_LENGTH),
        ],
      })),
      ...summaries.map((summary) => ({
        sql: 'INSERT INTO dataset_import_diagnostic_summaries (upload_id, diagnostic_category, field_name, reason, rule_code, count) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(upload_id, diagnostic_category, field_name, reason, rule_code) DO UPDATE SET count = count + excluded.count',
        args: [uploadId, summary.category, summary.field, summary.reason, summary.ruleCode, summary.count],
      })),
    ];

    await client.batch(statements, 'write');
    pendingDiagnostics.splice(0, diagnostics.length);
    summaryBuckets.clear();
    pendingCount = 0;
  }

  return {
    failures() {
      return [...countsByReason.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, count]) => ({ count, message: FAILURE_MESSAGES[reason], reason }));
    },
    flush,
    async record(diagnostic) {
      countsByReason.set(diagnostic.reason, (countsByReason.get(diagnostic.reason) ?? 0) + 1);
      addToSummary(summaryBuckets, diagnostic);
      pendingCount += 1;

      if (diagnosticCount < MAX_PERSISTED_DIAGNOSTICS) {
        pendingDiagnostics.push(diagnostic);
        diagnosticCount += 1;
      }

      if (pendingCount >= DIAGNOSTIC_BATCH_SIZE) {
        await flush();
      }
    },
  };
}

export async function clearDatasetImportDiagnostics(client: Client, uploadId: string): Promise<void> {
  await client.batch([
    { sql: 'DELETE FROM dataset_import_diagnostic_summaries WHERE upload_id = ?', args: [uploadId] },
    { sql: 'DELETE FROM dataset_import_diagnostics WHERE upload_id = ?', args: [uploadId] },
  ], 'write');
}

export async function listDatasetImportDiagnostics(
  client: Client,
  uploadId: string,
  pagination: DatasetDiagnosticsPagination,
): Promise<DatasetDiagnosticsPage | null> {
  const upload = await client.execute({ sql: 'SELECT file_name, file_type FROM dataset_uploads WHERE id = ?', args: [uploadId] });
  const uploadRow = upload.rows[0];

  if (!uploadRow) {
    return null;
  }

  const limit = normalizeLimit(pagination.limit);
  const offset = normalizeOffset(pagination.offset);
  const [countResult, summaryResult, diagnosticsResult] = await Promise.all([
    client.execute({ sql: 'SELECT COUNT(*) AS count FROM dataset_import_diagnostics WHERE upload_id = ?', args: [uploadId] }),
    client.execute({
      sql: 'SELECT diagnostic_category, field_name, reason, rule_code, count FROM dataset_import_diagnostic_summaries WHERE upload_id = ? ORDER BY count DESC, diagnostic_category ASC, reason ASC, rule_code ASC, field_name ASC',
      args: [uploadId],
    }),
    client.execute({
      sql: 'SELECT id, line_start, line_end, field_name, value_preview, diagnostic_category, reason, rule_code, message FROM dataset_import_diagnostics WHERE upload_id = ? ORDER BY CASE WHEN line_start IS NULL THEN 1 ELSE 0 END, line_start ASC, id ASC LIMIT ? OFFSET ?',
      args: [uploadId, limit, offset],
    }),
  ]);
  const fileName = String(uploadRow.file_name);
  const fileType = String(uploadRow.file_type) as DatasetFileType;
  const summary = summaryResult.rows.map(toSummary);
  const total = Number(countResult.rows[0]?.count ?? 0);
  const detectedTotal = summary.reduce((count, item) => count + item.count, 0);

  return {
    diagnostics: diagnosticsResult.rows.map((row) => toDiagnostic(row, fileName, fileType)),
    page: { detectedTotal, limit, offset, total, truncated: detectedTotal > total },
    summary,
  };
}

function addToSummary(buckets: Map<string, SummaryBucket>, diagnostic: DatasetImportDiagnosticInput): void {
  const bucket = toSummaryBucket(diagnostic);
  let key = summaryKey(bucket);

  if (!buckets.has(key) && buckets.size >= MAX_SUMMARY_BUCKETS) {
    bucket.field = '';
    bucket.ruleCode = 'summary_bucket_limit';
    key = summaryKey(bucket);
  }

  const current = buckets.get(key);

  if (current) {
    current.count += 1;
    return;
  }

  buckets.set(key, bucket);
}

function toSummaryBucket(diagnostic: DatasetImportDiagnosticInput): SummaryBucket {
  return {
    category: diagnostic.category,
    count: 1,
    field: normalizeSummaryField(diagnostic.field),
    reason: diagnostic.reason,
    ruleCode: limitText(diagnostic.ruleCode, MAX_FIELD_LENGTH),
  };
}

function summaryKey(bucket: SummaryBucket): string {
  return [bucket.category, bucket.field, bucket.reason, bucket.ruleCode].join('\u0000');
}

function toDiagnostic(row: Record<string, unknown>, fileName: string, fileType: DatasetFileType): DatasetImportDiagnostic {
  return {
    category: String(row.diagnostic_category) as DatasetDiagnosticCategory,
    field: toNullableString(row.field_name),
    fileName,
    fileType,
    id: String(row.id),
    lineEnd: toNullableNumber(row.line_end),
    lineStart: toNullableNumber(row.line_start),
    message: String(row.message),
    reason: String(row.reason) as DatasetFailureReason,
    ruleCode: String(row.rule_code),
    value: toNullableString(row.value_preview),
  };
}

function toSummary(row: Record<string, unknown>): DatasetDiagnosticSummary {
  return {
    category: String(row.diagnostic_category) as DatasetDiagnosticCategory,
    count: Number(row.count),
    field: toNullableString(row.field_name),
    reason: String(row.reason) as DatasetFailureReason,
    ruleCode: String(row.rule_code),
  };
}

function previewValue(field: string | null, value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = normalizeText(value);

  if (normalized.length === 0) {
    return '';
  }

  if (!isSafeValueField(field)) {
    return '[mascarado]';
  }

  return limitText(normalized, MAX_VALUE_PREVIEW_LENGTH);
}

function isSafeValueField(field: string | null): boolean {
  if (!field || /(authorization|cookie|password|secret|token|api[_-]?key|user_?id)$/i.test(field)) {
    return false;
  }

  return SAFE_VALUE_FIELDS.has(field.replace(/\[\d+\]/g, '[]'));
}

function normalizeSummaryField(field: string | null): string {
  return (sanitizeField(field) ?? '').replace(/\[\d+\]/g, '[]');
}

function sanitizeField(field: string | null): string | null {
  if (field === null) {
    return null;
  }

  const normalized = normalizeText(field);

  if (!/^[A-Za-z_][A-Za-z0-9_.[\]-]*$/.test(normalized)) {
    return '[mascarado]';
  }

  return limitText(normalized, MAX_FIELD_LENGTH);
}

function limitText(value: string, maximumLength: number): string {
  const normalized = normalizeText(value);

  return normalized.length > maximumLength
    ? normalized.slice(0, maximumLength - 1) + '…'
    : normalized;
}

function normalizeText(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').trim();
}

function normalizeLimit(value: number): number {
  return Number.isSafeInteger(value) ? Math.min(Math.max(value, 1), 100) : 50;
}

function normalizeOffset(value: number): number {
  return Number.isSafeInteger(value) ? Math.max(value, 0) : 0;
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined || String(value).length === 0) {
    return null;
  }

  return String(value);
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
