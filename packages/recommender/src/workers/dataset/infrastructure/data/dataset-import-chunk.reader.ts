import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import type { CsvRecord } from './csv.reader.js';

export const DATASET_IMPORT_SUB_BATCH_SIZE = 100;

export async function* readDatasetImportChunkRecords(payloadPath: string, expectedHash: string): AsyncGenerator<CsvRecord> {
  const input = createReadStream(payloadPath, { encoding: 'utf8' });
  yield* readDatasetImportChunkRecordsFromStream(input, expectedHash);
}

export async function* readDatasetImportChunkRecordsFromStream(input: Readable, expectedHash: string): AsyncGenerator<CsvRecord> {
  const hash = createHash('sha256');
  const lines = createInterface({ crlfDelay: Infinity, input });

  try {
    for await (const line of lines) {
      hash.update(`${line}\n`);
      yield parseRecord(line);
    }
  } finally {
    lines.close();
    input.destroy();
  }

  if (hash.digest('hex') !== expectedHash) {
    throw new Error('O conteúdo do chunk não corresponde ao checkpoint registrado.');
  }
}

export async function* readDatasetImportChunkRecordBatches(
  payloadPath: string,
  expectedHash: string,
  batchSize = DATASET_IMPORT_SUB_BATCH_SIZE,
): AsyncGenerator<CsvRecord[]> {
  let batch: CsvRecord[] = [];

  for await (const record of readDatasetImportChunkRecords(payloadPath, expectedHash)) {
    batch.push(record);

    if (batch.length === batchSize) {
      yield batch;
      batch = [];
    }
  }

  if (batch.length > 0) {
    yield batch;
  }
}

function parseRecord(line: string): CsvRecord {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('O payload do chunk contém uma linha JSON inválida.');
  }

  if (!isCsvRecord(value)) {
    throw new Error('O payload do chunk contém um registro inválido.');
  }

  return value;
}

function isCsvRecord(value: unknown): value is CsvRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as CsvRecord;
  return Number.isInteger(record.lineStart)
    && Number.isInteger(record.lineEnd)
    && typeof record.row === 'object'
    && record.row !== null
    && Object.values(record.row).every((field) => typeof field === 'string')
    && (record.issue === null || typeof record.issue === 'object');
}
