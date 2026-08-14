import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient } from '@libsql/client';
import { createDatasetImportChunk } from './dataset-import-chunks.repository.js';
import { createDatasetUploadWithJob } from './dataset-import-queue.repository.js';
import { listDatasetImportRatingChunkStats, replaceDatasetImportRatingChunkStats } from './dataset-import-rating-chunk-stats.repository.js';

describe('staging de estatísticas de ratings por chunk', () => {
  it('deve substituir o estágio do chunk sem duplicar as estatísticas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-rating-stage-'));
    const client = createClient({ url: `file:${join(directory, 'database.db')}` });

    try {
      await client.executeMultiple(await readFile('packages/database/src/schema.sql', 'utf8'));
      await client.execute({
        sql: `INSERT INTO movies (id, tmdb_id, title, original_title, release_year, runtime_minutes)
          VALUES ('10', '10', 'Filme', 'Filme', 2000, 90)`,
        args: [],
      });
      const upload = await createDatasetUploadWithJob(client, { fileName: 'ratings.csv', sizeBytes: 10, storagePath: '/tmp/ratings.csv', type: 'ratings' });
      const chunk = await createDatasetImportChunk(client, upload.jobId, {
        contentHash: 'hash', lineEnd: 2, lineStart: 2, payloadPath: '/tmp/chunk.jsonl', recordCount: 1, sequence: 0,
      });

      const first = ratingStats(chunk.id, 2, 9, 4.5, 0.5);
      await replaceDatasetImportRatingChunkStats(client, chunk.id, [first]);
      await replaceDatasetImportRatingChunkStats(client, chunk.id, [ratingStats(chunk.id, 1, 4, 4, 0)]);

      assert.deepEqual(await listDatasetImportRatingChunkStats(client, chunk.id), [ratingStats(chunk.id, 1, 4, 4, 0)]);
    } finally {
      await client.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function ratingStats(chunkId: string, ratingCount: number, ratingSum: number, ratingMean: number, ratingM2: number) {
  return {
    chunkId,
    firstRatingAt: '1970-01-01T00:01:40.000Z',
    lastRatingAt: '1970-01-01T00:01:41.000Z',
    movieId: '10',
    movieLensId: 1,
    ratingCount,
    ratingM2,
    ratingMax: 5,
    ratingMean,
    ratingMin: 4,
    ratingSum,
  };
}
