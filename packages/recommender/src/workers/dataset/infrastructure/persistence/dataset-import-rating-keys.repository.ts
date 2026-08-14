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
  chunkId: string,
  keys: readonly DatasetImportRatingKey[],
): Promise<boolean[]> {
  if (keys.length === 0) {
    return [];
  }

  const results = await client.batch(keys.map((key) => ({
    sql: `INSERT OR IGNORE INTO dataset_import_rating_keys (upload_id, chunk_id, user_id, movie_lens_id)
      VALUES (?, ?, ?, ?)`,
    args: [uploadId, chunkId, key.userId, key.movieLensId],
  })), 'write');

  return Promise.all(results.map(async (result, index) => {
    if (result.rowsAffected === 1) {
      return true;
    }

    const key = keys[index];
    const existing = await client.execute({
      sql: `SELECT chunk_id FROM dataset_import_rating_keys
        WHERE upload_id = ? AND user_id = ? AND movie_lens_id = ?`,
      args: [uploadId, key.userId, key.movieLensId],
    });

    return String(existing.rows[0]?.chunk_id ?? '') === chunkId;
  }));
}
