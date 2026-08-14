import type { Client } from '@libsql/client';
import { parsePositiveInteger, readCsvRecords, type CsvRecord } from '../../data/csv.reader.js';
import { createDatasetDiagnostic, validateDatasetRecord } from '../../validation/dataset-csv.validator.js';
import type { DatasetImportDiagnosticsCollector } from '../dataset-import-diagnostics.repository.js';
import { reserveDatasetImportLinkKey, type DatasetImportLinkChunkRecord } from '../dataset-import-link-chunk-records.repository.js';

export interface LinksImportResult {
  importedRows: number;
  processedRows: number;
  rejectedRows: number;
}

export async function collectLinkChunkRecords(
  client: Client,
  records: AsyncIterable<CsvRecord> | Iterable<CsvRecord>,
  uploadId: string,
  chunkId: string,
  diagnostics: DatasetImportDiagnosticsCollector,
  seenMovieLensIds = new Set<number>(),
): Promise<{ records: DatasetImportLinkChunkRecord[]; result: LinksImportResult }> {
  const staged: DatasetImportLinkChunkRecord[] = [];
  let importedRows = 0;
  let processedRows = 0;
  let rejectedRows = 0;

  for await (const record of records) {
    processedRows += 1;
    const issues = validateDatasetRecord('links', record);
    if (issues.length > 0) {
      await recordDiagnostics(diagnostics, issues);
      rejectedRows += 1;
      continue;
    }
    const movieLensId = parsePositiveInteger(record.row.movieId);
    const tmdbId = parsePositiveInteger(record.row.tmdbId);
    if (movieLensId === null || tmdbId === null) {
      await diagnostics.record(createDatasetDiagnostic(record, { category: 'validation', field: 'movieId', message: 'Nao foi possivel normalizar os identificadores do vinculo.', reason: 'invalid_field', ruleCode: 'link_normalization', value: record.row.movieId ?? null }));
      rejectedRows += 1;
      continue;
    }
    const stagedRecord = { lineEnd: record.lineEnd, lineStart: record.lineStart, movieLensId, tmdbId };
    if (seenMovieLensIds.has(movieLensId)) {
      await diagnostics.record(createDatasetDiagnostic(record, duplicateDiagnostic('movieId', String(movieLensId), 'duplicate_movielens_id', 'movieId aparece mais de uma vez no chunk.')));
      rejectedRows += 1;
      continue;
    }
    if (!await reserveDatasetImportLinkKey(client, uploadId, chunkId, stagedRecord)) {
      await diagnostics.record(createDatasetDiagnostic(record, duplicateDiagnostic('movieId', String(movieLensId), 'duplicate_or_conflicting_link', 'O vinculo já foi informado por outro chunk do upload.')));
      rejectedRows += 1;
      continue;
    }
    staged.push(stagedRecord);
    seenMovieLensIds.add(movieLensId);
    importedRows += 1;
  }
  return { records: staged, result: { importedRows, processedRows, rejectedRows } };
}

export async function importLinks(client: Client, filePath: string, diagnostics: DatasetImportDiagnosticsCollector): Promise<LinksImportResult> {
  return importLinkRecords(client, readCsvRecords(filePath), diagnostics);
}

export async function importLinkRecords(
  client: Client,
  records: AsyncIterable<CsvRecord>,
  diagnostics: DatasetImportDiagnosticsCollector,
): Promise<LinksImportResult> {
  const identities = await loadLinkIdentities(client);
  const seenMovieLensIds = new Set<number>();
  const seenTmdbIds = new Set<number>();
  let importedRows = 0;
  let processedRows = 0;
  let rejectedRows = 0;

  for await (const record of records) {
    processedRows += 1;
    const validationIssues = validateDatasetRecord('links', record);

    if (validationIssues.length > 0) {
      await recordDiagnostics(diagnostics, validationIssues);
      rejectedRows += 1;
      continue;
    }

    const movieLensId = parsePositiveInteger(record.row.movieId);
    const tmdbId = parsePositiveInteger(record.row.tmdbId);

    if (movieLensId === null || tmdbId === null) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'validation',
        field: 'movieId',
        message: 'Nao foi possivel normalizar os identificadores do vinculo.',
        reason: 'invalid_field',
        ruleCode: 'link_normalization',
        value: record.row.movieId ?? null,
      }));
      rejectedRows += 1;
      continue;
    }

    const conflict = findLinkConflict(movieLensId, tmdbId, identities, seenMovieLensIds, seenTmdbIds);

    if (conflict) {
      await diagnostics.record(createDatasetDiagnostic(record, conflict));
      rejectedRows += 1;
      continue;
    }

    identities.linksByMovieLensId.set(movieLensId, tmdbId);
    identities.linksByTmdbId.set(tmdbId, movieLensId);
    seenMovieLensIds.add(movieLensId);
    seenTmdbIds.add(tmdbId);

    await client.batch([
      {
        sql: `INSERT INTO dataset_movie_links (movie_lens_id, tmdb_id, created_at, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(movie_lens_id) DO UPDATE SET tmdb_id = excluded.tmdb_id, updated_at = CURRENT_TIMESTAMP`,
        args: [movieLensId, String(tmdbId)],
      },
      {
        sql: `UPDATE OR IGNORE movies SET movie_lens_id = ?
          WHERE tmdb_id = ? AND (movie_lens_id IS NULL OR movie_lens_id = ?)`,
        args: [movieLensId, String(tmdbId), movieLensId],
      },
    ], 'write');
    importedRows += 1;
  }

  return { importedRows, processedRows, rejectedRows };
}

interface LinkIdentities {
  linksByMovieLensId: Map<number, number>;
  linksByTmdbId: Map<number, number>;
  moviesByMovieLensId: Map<number, number>;
  moviesByTmdbId: Map<number, number>;
}

function findLinkConflict(
  movieLensId: number,
  tmdbId: number,
  identities: LinkIdentities,
  seenMovieLensIds: Set<number>,
  seenTmdbIds: Set<number>,
) {
  if (seenMovieLensIds.has(movieLensId)) {
    return duplicateDiagnostic('movieId', String(movieLensId), 'duplicate_movielens_id', 'movieId aparece mais de uma vez no arquivo.');
  }

  if (seenTmdbIds.has(tmdbId)) {
    return duplicateDiagnostic('tmdbId', String(tmdbId), 'duplicate_tmdb_id', 'tmdbId aparece mais de uma vez no arquivo.');
  }

  if (hasMappingConflict([identities.linksByMovieLensId, identities.moviesByMovieLensId], movieLensId, tmdbId)) {
    return duplicateDiagnostic('movieId', String(movieLensId), 'conflicting_movielens_mapping', 'movieId ja esta associado a outro tmdbId.');
  }

  if (hasMappingConflict([identities.linksByTmdbId, identities.moviesByTmdbId], tmdbId, movieLensId)) {
    return duplicateDiagnostic('tmdbId', String(tmdbId), 'conflicting_tmdb_mapping', 'tmdbId ja esta associado a outro movieId.');
  }

  return null;
}

function duplicateDiagnostic(field: string, value: string, ruleCode: string, message: string) {
  return { category: 'integrity' as const, field, message, reason: 'duplicate_value' as const, ruleCode, value };
}

async function loadLinkIdentities(client: Client): Promise<LinkIdentities> {
  const [linksResult, moviesResult] = await Promise.all([
    client.execute('SELECT movie_lens_id, tmdb_id FROM dataset_movie_links'),
    client.execute('SELECT movie_lens_id, tmdb_id FROM movies WHERE movie_lens_id IS NOT NULL'),
  ]);
  const linksByMovieLensId = new Map<number, number>();
  const linksByTmdbId = new Map<number, number>();
  const moviesByMovieLensId = new Map<number, number>();
  const moviesByTmdbId = new Map<number, number>();

  for (const row of linksResult.rows) {
    addLinkIdentity(linksByMovieLensId, linksByTmdbId, row.movie_lens_id, row.tmdb_id);
  }

  for (const row of moviesResult.rows) {
    addLinkIdentity(moviesByMovieLensId, moviesByTmdbId, row.movie_lens_id, row.tmdb_id);
  }

  return { linksByMovieLensId, linksByTmdbId, moviesByMovieLensId, moviesByTmdbId };
}

function hasMappingConflict(mappings: readonly Map<number, number>[], key: number, expectedValue: number): boolean {
  return mappings.some((mapping) => {
    const value = mapping.get(key);
    return value !== undefined && value !== expectedValue;
  });
}

function addLinkIdentity(byMovieLensId: Map<number, number>, byTmdbId: Map<number, number>, movieLensIdValue: unknown, tmdbIdValue: unknown): void {
  const movieLensId = Number(movieLensIdValue);
  const tmdbId = Number(tmdbIdValue);

  if (!Number.isSafeInteger(movieLensId) || !Number.isSafeInteger(tmdbId)) {
    return;
  }

  byMovieLensId.set(movieLensId, tmdbId);
  byTmdbId.set(tmdbId, movieLensId);
}

async function recordDiagnostics(diagnostics: DatasetImportDiagnosticsCollector, issues: Parameters<DatasetImportDiagnosticsCollector['record']>[0][]): Promise<void> {
  for (const issue of issues) {
    await diagnostics.record(issue);
  }
}
