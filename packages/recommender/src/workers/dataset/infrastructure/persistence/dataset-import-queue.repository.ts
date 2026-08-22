import type { Client } from '@libsql/client';
import { recordImportJobSummary } from '@pkg/observability';
import type {
  DatasetDependency,
  DatasetFailure,
  DatasetFileType,
  DatasetImportJob,
  DatasetImportJobStatus,
  DatasetImportResult,
  DatasetUpload,
  DatasetUploadInput,
  DatasetUploadStatus,
} from '../../domain/dataset-import-queue.types.js';
import { resolveDatasetUploadStatus } from '../../domain/dataset-upload-status.service.js';

export interface StoredDatasetImportJob extends DatasetImportJob {
  storagePath: string | null;
}

export async function createDatasetUploadWithJob(client: Client, upload: DatasetUploadInput, uploadId: string = crypto.randomUUID()): Promise<DatasetUpload> {
  const jobId = crypto.randomUUID();

  await client.batch([
    {
      sql: `INSERT OR IGNORE INTO dataset_uploads (id, file_name, file_type, storage_path, size_bytes, status)
        VALUES (?, ?, ?, ?, ?, 'queued')`,
      args: [uploadId, upload.fileName, upload.type, upload.storagePath, upload.sizeBytes],
    },
    {
      sql: `INSERT OR IGNORE INTO dataset_import_jobs (id, upload_id, file_type, status)
        VALUES (?, ?, ?, 'queued')`,
      args: [jobId, uploadId, upload.type],
    },
  ], 'write');

  const existing = await findDatasetUpload(client, uploadId);
  if (existing) return existing;

  return {
    completedAt: null,
    createdAt: new Date().toISOString(),
    dependencies: [],
    errorMessage: null,
    failures: [],
    fileName: upload.fileName,
    id: uploadId,
    jobId,
    sizeBytes: upload.sizeBytes,
    status: 'queued',
    summary: emptySummary(),
    type: upload.type,
  };
}

export async function claimNextDatasetImportJob(client: Client): Promise<StoredDatasetImportJob | null> {
  const next = await client.execute(`SELECT id FROM dataset_import_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`);
  const jobId = String(next.rows[0]?.id ?? '');

  if (!jobId) {
    return null;
  }

  const claim = await client.execute({
    sql: `UPDATE OR IGNORE dataset_import_jobs
      SET status = 'processing', attempt_count = attempt_count + 1, started_at = CURRENT_TIMESTAMP, error_message = NULL
      WHERE id = ? AND status = 'queued'`,
    args: [jobId],
  });

  if (claim.rowsAffected !== 1) {
    return null;
  }

  await client.execute({
    sql: `UPDATE dataset_uploads SET status = 'processing', updated_at = CURRENT_TIMESTAMP, error_message = NULL
      WHERE id = (SELECT upload_id FROM dataset_import_jobs WHERE id = ?)`,
    args: [jobId],
  });

  return findStoredJob(client, jobId);
}

export async function completeDatasetImportJob(client: Client, job: Pick<StoredDatasetImportJob, 'id' | 'uploadId'>, result: DatasetImportResult): Promise<void> {
  const status = resolveDatasetUploadStatus(result);

  await client.batch([
    {
      sql: `UPDATE dataset_import_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ?`,
      args: [job.id],
    },
    {
      sql: `UPDATE dataset_uploads
        SET status = CASE WHEN status = 'partial_error' THEN 'partial_error' ELSE ? END,
          processed_rows = ?, imported_rows = ?, rejected_rows = ?, waiting_dependency_rows = ?,
          failures_json = ?, dependencies_json = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP,
          completed_at = CURRENT_TIMESTAMP, storage_path = NULL
        WHERE id = ?`,
      args: [
        status,
        result.summary.processed,
        result.summary.imported,
        result.summary.rejected,
        result.summary.waitingDependencies,
        JSON.stringify(result.failures),
        JSON.stringify(result.dependencies),
        job.uploadId,
      ],
    },
    { sql: 'DELETE FROM dataset_import_rating_keys WHERE upload_id = ?', args: [job.uploadId] },
    { sql: 'DELETE FROM dataset_import_link_keys WHERE upload_id = ?', args: [job.uploadId] },
  ], 'write');

  recordImportJobSummary({
    imported: result.summary.imported,
    jobId: job.id,
    processed: result.summary.processed,
    rejected: result.summary.rejected,
    result: status,
    waitingDependencies: result.summary.waitingDependencies,
  });
}

export async function startDatasetImportJob(client: Client, job: Pick<StoredDatasetImportJob, 'id' | 'uploadId'>): Promise<void> {
  await client.batch([
    { sql: "UPDATE dataset_import_jobs SET status = 'processing', started_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'", args: [job.id] },
    { sql: "UPDATE dataset_uploads SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'", args: [job.uploadId] },
  ], 'write');
}

export async function waitForDatasetDependencies(
  client: Client,
  job: StoredDatasetImportJob,
  dependencies: DatasetDependency[],
  waitingDependencies?: number,
): Promise<void> {
  const chunks = await client.execute({
    sql: `SELECT COALESCE(SUM(processed_rows), 0) AS processed, COALESCE(SUM(imported_rows), 0) AS imported,
      COALESCE(SUM(rejected_rows), 0) AS rejected, COALESCE(SUM(missing_dependency_rows), 0) AS waiting_dependencies
      FROM dataset_import_chunks WHERE job_id = ?`,
    args: [job.id],
  });
  const summary = chunks.rows[0] ?? {};

  await client.batch([
    {
      sql: `UPDATE dataset_import_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ?`,
      args: [job.id],
    },
    {
      sql: `UPDATE dataset_uploads
        SET status = 'partial_error', processed_rows = ?, imported_rows = ?, rejected_rows = ?, waiting_dependency_rows = ?,
          dependencies_json = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP, storage_path = NULL,
          error_message = NULL
        WHERE id = ?`,
      args: [
        Number(summary.processed ?? 0),
        Number(summary.imported ?? 0),
        Number(summary.rejected ?? 0),
        waitingDependencies ?? Number(summary.waiting_dependencies ?? 0),
        JSON.stringify(dependencies),
        job.uploadId,
      ],
    },
  ], 'write');
}

export async function failDatasetImportJob(client: Client, job: Pick<StoredDatasetImportJob, 'id' | 'uploadId'>, errorMessage: string, failures: DatasetFailure[]): Promise<void> {
  await client.batch([
    {
      sql: `UPDATE dataset_import_chunks
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ?
        WHERE job_id = ? AND status IN ('queued', 'processing')`,
      args: [errorMessage, job.id],
    },
    {
      sql: `UPDATE dataset_import_jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?`,
      args: [errorMessage, job.id],
    },
    {
      sql: `UPDATE dataset_uploads
        SET status = 'error', failures_json = ?, dependencies_json = '[]', error_message = ?, updated_at = CURRENT_TIMESTAMP,
          completed_at = CURRENT_TIMESTAMP, storage_path = NULL
        WHERE id = ?`,
      args: [JSON.stringify(failures), errorMessage, job.uploadId],
    },
    { sql: 'DELETE FROM dataset_import_rating_keys WHERE upload_id = ?', args: [job.uploadId] },
    { sql: 'DELETE FROM dataset_import_link_keys WHERE upload_id = ?', args: [job.uploadId] },
  ], 'write');

  recordImportJobSummary({
    imported: 0,
    jobId: job.id,
    processed: 0,
    rejected: 0,
    result: 'error',
    waitingDependencies: 0,
  });
}

export async function requeueRetryableDatasetImportJob(client: Client, job: StoredDatasetImportJob, errorMessage: string): Promise<void> {
  await client.batch([
    {
      sql: `UPDATE dataset_import_jobs
        SET status = 'queued', error_message = ?, completed_at = NULL
        WHERE id = ? AND status = 'processing'`,
      args: [errorMessage, job.id],
    },
    {
      sql: `UPDATE dataset_uploads
        SET status = 'queued', error_message = ?, failures_json = '[]', dependencies_json = '[]',
          completed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      args: [errorMessage, job.uploadId],
    },
  ], 'write');
}

export async function requeueWaitingDatasetJobs(client: Client, dependency: DatasetDependency['type']): Promise<void> {
  const waiting = await client.execute(`SELECT id, upload_id FROM dataset_import_jobs WHERE status = 'waiting_dependencies'`);

  for (const row of waiting.rows) {
    const jobId = String(row.id);
    const uploadId = String(row.upload_id);
    const upload = await client.execute({ sql: 'SELECT dependencies_json FROM dataset_uploads WHERE id = ?', args: [uploadId] });
    const dependencies = parseDependencies(upload.rows[0]?.dependencies_json);

    if (!dependencies.some((item) => item.type === dependency)) {
      continue;
    }

    await client.batch([
      { sql: `UPDATE dataset_import_jobs SET status = 'queued', error_message = NULL WHERE id = ?`, args: [jobId] },
      {
        sql: `UPDATE dataset_uploads SET status = 'queued', dependencies_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [uploadId],
      },
    ], 'write');
  }
}

export async function requeueInterruptedDatasetImportJobs(client: Client): Promise<void> {
  await client.batch([
    {
      sql: `UPDATE dataset_import_jobs
        SET status = 'queued', error_message = NULL
        WHERE status = 'processing'`,
      args: [],
    },
    {
      sql: `UPDATE dataset_import_chunks SET status = 'queued', error_message = NULL, completed_at = NULL
        WHERE status = 'processing' AND job_id IN (SELECT id FROM dataset_import_jobs WHERE status = 'queued')`,
      args: [],
    },
    {
      sql: `UPDATE dataset_uploads
        SET status = 'queued', error_message = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT upload_id FROM dataset_import_jobs WHERE status = 'queued')
          AND status = 'processing'`,
      args: [],
    },
  ], 'write');
}

export async function listDatasetUploads(client: Client): Promise<DatasetUpload[]> {
  const result = await client.execute(`SELECT uploads.*, jobs.id AS job_id,
    CASE WHEN jobs.file_type = 'ratings' AND uploads.status = 'partial_error'
      AND uploads.waiting_dependency_rows > 0
      AND EXISTS (
        SELECT 1 FROM dataset_import_chunks chunks
        WHERE chunks.job_id = jobs.id
          AND chunks.status = 'completed'
          AND chunks.imported_rows > 0
          AND chunks.rating_stats_materialized_at IS NULL
      ) THEN 'processing' ELSE uploads.status END AS display_status
    FROM dataset_uploads uploads JOIN dataset_import_jobs jobs ON jobs.upload_id = uploads.id
    ORDER BY uploads.created_at DESC`);

  return result.rows.map(toDatasetUpload);
}

export async function findDatasetUpload(client: Client, uploadId: string): Promise<DatasetUpload | null> {
  const result = await client.execute({
    sql: `SELECT uploads.*, jobs.id AS job_id,
      CASE WHEN jobs.file_type = 'ratings' AND uploads.status = 'partial_error'
        AND uploads.waiting_dependency_rows > 0
        AND EXISTS (
          SELECT 1 FROM dataset_import_chunks chunks
          WHERE chunks.job_id = jobs.id
            AND chunks.status = 'completed'
            AND chunks.imported_rows > 0
            AND chunks.rating_stats_materialized_at IS NULL
        ) THEN 'processing' ELSE uploads.status END AS display_status
      FROM dataset_uploads uploads JOIN dataset_import_jobs jobs ON jobs.upload_id = uploads.id WHERE uploads.id = ?`,
    args: [uploadId],
  });

  return result.rows[0] ? toDatasetUpload(result.rows[0]) : null;
}

export async function listDatasetImportJobs(client: Client): Promise<DatasetImportJob[]> {
  const result = await client.execute(`SELECT id, upload_id, file_type, status, attempt_count, error_message, created_at, completed_at
    FROM dataset_import_jobs ORDER BY created_at DESC`);

  return result.rows.map(toDatasetImportJob);
}

export async function countRows(client: Client, tableName: 'dataset_movie_links' | 'movies'): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return Number(result.rows[0]?.count ?? 0);
}

export async function findStoredJob(client: Client, jobId: string): Promise<StoredDatasetImportJob | null> {
  const result = await client.execute({
    sql: `SELECT jobs.id, jobs.upload_id, jobs.file_type, jobs.status, jobs.attempt_count, jobs.error_message,
      jobs.created_at, jobs.completed_at, uploads.storage_path
      FROM dataset_import_jobs jobs JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id WHERE jobs.id = ?`,
    args: [jobId],
  });

  const row = result.rows[0];

  return row
    ? { ...toDatasetImportJob(row), storagePath: row.storage_path === null ? null : String(row.storage_path) }
    : null;
}

function toDatasetUpload(row: Record<string, unknown>): DatasetUpload {
  return {
    completedAt: toNullableString(row.completed_at),
    createdAt: String(row.created_at),
    dependencies: parseDependencies(row.dependencies_json),
    errorMessage: toNullableString(row.error_message),
    failures: parseFailures(row.failures_json),
    fileName: String(row.file_name),
    id: String(row.id),
    jobId: String(row.job_id),
    sizeBytes: Number(row.size_bytes),
    status: String(row.display_status ?? row.status) as DatasetUploadStatus,
    summary: {
      imported: Number(row.imported_rows),
      processed: Number(row.processed_rows),
      rejected: Number(row.rejected_rows),
      waitingDependencies: Number(row.waiting_dependency_rows),
    },
    type: String(row.file_type) as DatasetFileType,
  };
}

function toDatasetImportJob(row: Record<string, unknown>): DatasetImportJob {
  return {
    attemptCount: Number(row.attempt_count),
    completedAt: toNullableString(row.completed_at),
    createdAt: String(row.created_at),
    errorMessage: toNullableString(row.error_message),
    id: String(row.id),
    status: String(row.status) as DatasetImportJobStatus,
    type: String(row.file_type) as DatasetFileType,
    uploadId: String(row.upload_id),
  };
}

function parseFailures(value: unknown): DatasetFailure[] {
  return parseJsonArray(value).filter(isDatasetFailure);
}

function parseDependencies(value: unknown): DatasetDependency[] {
  return parseJsonArray(value).filter(isDatasetDependency);
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isDatasetFailure(value: unknown): value is DatasetFailure {
  return typeof value === 'object' && value !== null && typeof (value as DatasetFailure).count === 'number' && typeof (value as DatasetFailure).message === 'string' && typeof (value as DatasetFailure).reason === 'string';
}

function isDatasetDependency(value: unknown): value is DatasetDependency {
  return typeof value === 'object' && value !== null && typeof (value as DatasetDependency).reason === 'string' && ((value as DatasetDependency).type === 'movies' || (value as DatasetDependency).type === 'links');
}

function emptySummary() {
  return { imported: 0, processed: 0, rejected: 0, waitingDependencies: 0 };
}

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
