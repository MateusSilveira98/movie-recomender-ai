import type { Client } from '@libsql/client';

export interface DatasetImportRatingKey {
  movieLensId: number;
  userId: number;
}

export async function clearDatasetImportRatingKeys(client: Client, uploadId: string): Promise<void> {
  await client.execute({ sql: 'DELETE FROM dataset_import_rating_keys WHERE upload_id = ?', args: [uploadId] });
}

export async function reserveDatasetImportRatingKeys(
  client: Client,
  uploadId: string,
  keys: readonly DatasetImportRatingKey[],
): Promise<boolean[]> {
  if (keys.length === 0) {
    return [];
  }

  const results = await client.batch(keys.map((key) => ({
    sql: `INSERT OR IGNORE INTO dataset_import_rating_keys (upload_id, user_id, movie_lens_id)
      VALUES (?, ?, ?)`,
    args: [uploadId, key.userId, key.movieLensId],
  })), 'write');

  return results.map((result) => result.rowsAffected === 1);
}
