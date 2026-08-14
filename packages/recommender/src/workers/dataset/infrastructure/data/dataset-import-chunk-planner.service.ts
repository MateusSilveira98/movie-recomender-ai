import { createHash } from 'node:crypto';
import type { DatasetImportChunkInput } from '../../domain/dataset-import-chunk.types.js';
import { readCsvRecords } from './csv.reader.js';

export const DATASET_IMPORT_CHUNK_RECORD_COUNT = 10_000;

export type DatasetImportChunkCheckpoint = Omit<DatasetImportChunkInput, 'payloadPath'>;

export async function planDatasetImportChunks(
  filePath: string,
  chunkSize: number = DATASET_IMPORT_CHUNK_RECORD_COUNT,
  persist: (chunk: DatasetImportChunkCheckpoint) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('O tamanho do chunk deve ser um inteiro positivo.');
  }

  let hash = createHash('sha256');
  let lineStart = 0;
  let lineEnd = 0;
  let recordCount = 0;
  let sequence = 0;

  for await (const record of readCsvRecords(filePath)) {
    if (recordCount === 0) {
      lineStart = record.lineStart;
    }

    hash.update(JSON.stringify({ issue: record.issue, lineEnd: record.lineEnd, lineStart: record.lineStart, row: record.row }));
    hash.update('\n');
    lineEnd = record.lineEnd;
    recordCount += 1;

    if (recordCount === chunkSize) {
      await persist(nextChunk());
    }
  }

  if (recordCount > 0) {
    await persist(nextChunk());
  }

  function nextChunk(): DatasetImportChunkCheckpoint {
    const chunk = { contentHash: hash.digest('hex'), lineEnd, lineStart, recordCount, sequence };
    hash = createHash('sha256');
    lineStart = 0;
    lineEnd = 0;
    recordCount = 0;
    sequence += 1;
    return chunk;
  }
}
