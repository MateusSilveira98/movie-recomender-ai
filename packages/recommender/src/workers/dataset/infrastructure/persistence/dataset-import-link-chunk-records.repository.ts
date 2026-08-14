import type { Client } from '@libsql/client';

export interface DatasetImportLinkChunkRecord {
  lineEnd: number;
  lineStart: number;
  movieLensId: number;
  tmdbId: number;
}

export async function reserveDatasetImportLinkKey(
  client: Client,
  uploadId: string,
  chunkId: string,
  record: DatasetImportLinkChunkRecord,
): Promise<boolean> {
  const inserted = await client.execute({
    sql: `INSERT OR IGNORE INTO dataset_import_link_keys (upload_id, chunk_id, movie_lens_id, tmdb_id)
      VALUES (?, ?, ?, ?)`,
    args: [uploadId, chunkId, record.movieLensId, record.tmdbId],
  });

  if (inserted.rowsAffected === 1) return true;

  const existing = await client.execute({
    sql: `SELECT chunk_id, tmdb_id FROM dataset_import_link_keys WHERE upload_id = ? AND movie_lens_id = ?`,
    args: [uploadId, record.movieLensId],
  });
  const row = existing.rows[0];
  return String(row?.chunk_id ?? '') === chunkId && Number(row?.tmdb_id) === record.tmdbId;
}

export async function replaceDatasetImportLinkChunkRecords(
  client: Client,
  chunkId: string,
  records: readonly DatasetImportLinkChunkRecord[],
): Promise<void> {
  await clearDatasetImportLinkChunkRecords(client, chunkId);
  await appendDatasetImportLinkChunkRecords(client, chunkId, records);
}

export async function clearDatasetImportLinkChunkRecords(client: Client, chunkId: string): Promise<void> {
  await client.execute({ sql: 'DELETE FROM dataset_import_link_chunk_records WHERE chunk_id = ?', args: [chunkId] });
}

export async function appendDatasetImportLinkChunkRecords(
  client: Client,
  chunkId: string,
  records: readonly DatasetImportLinkChunkRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await client.batch(records.map((record) => ({
    sql: `INSERT INTO dataset_import_link_chunk_records (chunk_id, line_start, line_end, movie_lens_id, tmdb_id)
      VALUES (?, ?, ?, ?, ?)`,
    args: [chunkId, record.lineStart, record.lineEnd, record.movieLensId, record.tmdbId],
  })), 'write');
}

export async function listDatasetImportLinkChunkRecords(client: Client, chunkIds: readonly string[]): Promise<DatasetImportLinkChunkRecord[]> {
  if (chunkIds.length === 0) return [];
  const placeholders = chunkIds.map(() => '?').join(', ');
  const result = await client.execute({
    sql: `SELECT line_start, line_end, movie_lens_id, tmdb_id FROM dataset_import_link_chunk_records
      WHERE chunk_id IN (${placeholders}) ORDER BY movie_lens_id`,
    args: [...chunkIds],
  });
  return result.rows.map((row) => ({
    lineEnd: Number(row.line_end), lineStart: Number(row.line_start), movieLensId: Number(row.movie_lens_id), tmdbId: Number(row.tmdb_id),
  }));
}

export async function listDatasetImportLinkChunkRecordsPage(client: Client, chunkIds: readonly string[], limit: number, offset: number): Promise<DatasetImportLinkChunkRecord[]> {
  if (chunkIds.length === 0) return [];
  const result = await client.execute({
    sql: `SELECT line_start, line_end, movie_lens_id, tmdb_id FROM dataset_import_link_chunk_records
      WHERE chunk_id IN (${chunkIds.map(() => '?').join(', ')}) ORDER BY movie_lens_id LIMIT ? OFFSET ?`,
    args: [...chunkIds, limit, offset],
  });
  return result.rows.map((row) => ({
    lineEnd: Number(row.line_end), lineStart: Number(row.line_start), movieLensId: Number(row.movie_lens_id), tmdbId: Number(row.tmdb_id),
  }));
}
