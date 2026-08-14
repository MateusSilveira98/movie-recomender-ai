import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import type { DatasetImportChunkInput } from '../../domain/dataset-import-chunk.types.js';
import { readCsvRecords, type CsvRecord } from './csv.reader.js';
import { DATASET_IMPORT_CHUNK_RECORD_COUNT } from './dataset-import-chunk-planner.service.js';

export async function materializeDatasetImportChunks(
  filePath: string,
  payloadDirectory: string,
  persist: (chunk: DatasetImportChunkInput) => Promise<void>,
  chunkSize: number = DATASET_IMPORT_CHUNK_RECORD_COUNT,
): Promise<void> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('O tamanho do chunk deve ser um inteiro positivo.');
  }

  await mkdir(payloadDirectory, { recursive: true });
  let context: ChunkWriteContext | null = null;
  let sequence = 0;

  for await (const record of readCsvRecords(filePath)) {
    context ??= createChunkWriteContext(payloadDirectory, sequence, record);
    const serialized = `${JSON.stringify(record)}\n`;
    context.hash.update(serialized);
    await write(context.writer, serialized);
    context.lineEnd = record.lineEnd;
    context.recordCount += 1;

    if (context.recordCount === chunkSize) {
      await finalizeChunk(context, persist);
      sequence += 1;
      context = null;
    }
  }

  if (context) {
    await finalizeChunk(context, persist);
  }
}

interface ChunkWriteContext {
  hash: ReturnType<typeof createHash>;
  lineEnd: number;
  lineStart: number;
  payloadPath: string;
  recordCount: number;
  temporaryPath: string;
  writer: ReturnType<typeof createWriteStream>;
  sequence: number;
}

function createChunkWriteContext(payloadDirectory: string, sequence: number, record: CsvRecord): ChunkWriteContext {
  const payloadPath = join(payloadDirectory, `chunk-${sequence}.jsonl`);

  return {
    hash: createHash('sha256'),
    lineEnd: record.lineEnd,
    lineStart: record.lineStart,
    payloadPath,
    recordCount: 0,
    sequence,
    temporaryPath: `${payloadPath}.tmp`,
    writer: createWriteStream(`${payloadPath}.tmp`, { encoding: 'utf8', flags: 'w' }),
  };
}

async function finalizeChunk(context: ChunkWriteContext, persist: (chunk: DatasetImportChunkInput) => Promise<void>): Promise<void> {
  context.writer.end();
  await once(context.writer, 'finish');
  await rename(context.temporaryPath, context.payloadPath);
  await persist({
    contentHash: context.hash.digest('hex'),
    lineEnd: context.lineEnd,
    lineStart: context.lineStart,
    payloadPath: context.payloadPath,
    recordCount: context.recordCount,
    sequence: context.sequence,
  });
}

async function write(writer: ReturnType<typeof createWriteStream>, value: string): Promise<void> {
  if (writer.write(value)) {
    return;
  }

  await once(writer, 'drain');
}
