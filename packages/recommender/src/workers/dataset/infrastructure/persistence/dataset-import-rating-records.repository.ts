import type { Client } from '@libsql/client';

export interface StagedRatingRecord {
  lineEnd: number;
  lineStart: number;
  movieLensId: number;
  ratedAt: number;
  rating: number;
  userId: number;
}

export async function replaceDatasetImportRatingRecords(
  client: Client,
  chunkId: string,
  records: readonly StagedRatingRecord[],
): Promise<void> {
  await clearDatasetImportRatingRecords(client, chunkId);
  await appendDatasetImportRatingRecords(client, chunkId, records);
}

export async function clearDatasetImportRatingRecords(client: Client, chunkId: string): Promise<void> {
  await client.execute({ sql: 'DELETE FROM dataset_import_rating_records WHERE chunk_id = ?', args: [chunkId] });
}

export async function appendDatasetImportRatingRecords(
  client: Client,
  chunkId: string,
  records: readonly StagedRatingRecord[],
): Promise<void> {
  for (let start = 0; start < records.length; start += 100) {
    await client.batch(records.slice(start, start + 100).map((record) => ({
      sql: `INSERT INTO dataset_import_rating_records
        (user_id, movie_lens_id, rating, rated_at, chunk_id, line_start, line_end)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, movie_lens_id) DO UPDATE SET
          rating = excluded.rating, rated_at = excluded.rated_at, chunk_id = excluded.chunk_id,
          line_start = excluded.line_start, line_end = excluded.line_end`,
      args: [record.userId, record.movieLensId, record.rating, record.ratedAt, chunkId, record.lineStart, record.lineEnd],
    })), 'write');
  }
}
