import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { DatasetImportChunkInput } from '../../domain/dataset-import-chunk.types.js';
import { materializeDatasetImportChunks } from './dataset-import-chunk-materializer.service.js';
import { readDatasetImportChunkRecordBatches } from './dataset-import-chunk.reader.js';

describe('materializador de chunks de importação', () => {
  it('deve gravar payloads recuperáveis por registros lógicos', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-chunk-payload-'));
    const filePath = join(directory, 'ratings.csv');
    const chunks: DatasetImportChunkInput[] = [];

    try {
      await writeFile(filePath, 'userId,movieId,rating,timestamp\n1,10,4,100\n2,10,5,101\n3,11,3,102\n');
      await materializeDatasetImportChunks(filePath, join(directory, 'chunks'), async (chunk) => { chunks.push(chunk); }, 2);

      assert.deepEqual(chunks.map((chunk) => ({ lineEnd: chunk.lineEnd, lineStart: chunk.lineStart, recordCount: chunk.recordCount, sequence: chunk.sequence })), [
        { lineEnd: 3, lineStart: 2, recordCount: 2, sequence: 0 },
        { lineEnd: 4, lineStart: 4, recordCount: 1, sequence: 1 },
      ]);
      assert.deepEqual((await readFile(chunks[0].payloadPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).row), [
        { movieId: '10', rating: '4', timestamp: '100', userId: '1' },
        { movieId: '10', rating: '5', timestamp: '101', userId: '2' },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve ler o payload em sublotes sem omitir registros', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-chunk-reader-'));
    const payloadPath = join(directory, 'ratings.jsonl');
    const payload = [
      JSON.stringify({ issue: null, lineEnd: 2, lineStart: 2, row: { movieId: '10' } }),
      JSON.stringify({ issue: null, lineEnd: 3, lineStart: 3, row: { movieId: '11' } }),
      JSON.stringify({ issue: null, lineEnd: 4, lineStart: 4, row: { movieId: '12' } }),
    ].join('\n').concat('\n');

    try {
      await writeFile(payloadPath, payload);
      const expectedHash = createHash('sha256').update(payload).digest('hex');
      const batches: string[][] = [];

      for await (const batch of readDatasetImportChunkRecordBatches(payloadPath, expectedHash, 2)) {
        batches.push(batch.map((record) => record.row.movieId!));
      }

      assert.deepEqual(batches, [['10', '11'], ['12']]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
