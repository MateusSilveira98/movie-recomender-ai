import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { planDatasetImportChunks, type DatasetImportChunkCheckpoint } from './dataset-import-chunk-planner.service.js';

describe('planejador de chunks de importação', () => {
  it('deve criar checkpoints por registros lógicos sem reter o lote', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-chunk-plan-'));
    const filePath = join(directory, 'ratings.csv');
    const chunks: DatasetImportChunkCheckpoint[] = [];

    try {
      await writeFile(filePath, 'userId,movieId,rating,timestamp\n1,1,4,100\n2,1,5,101\n3,2,3,102\n');

      await planDatasetImportChunks(filePath, 2, async (chunk) => {
        chunks.push(chunk);
      });

      assert.deepEqual(chunks.map(({ contentHash, lineEnd, lineStart, recordCount, sequence }) => ({
        hasHash: contentHash.length === 64,
        lineEnd,
        lineStart,
        recordCount,
        sequence,
      })), [
        { hasHash: true, lineEnd: 3, lineStart: 2, recordCount: 2, sequence: 0 },
        { hasHash: true, lineEnd: 4, lineStart: 4, recordCount: 1, sequence: 1 },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
