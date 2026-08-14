import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { CsvRecord } from '../data/csv.reader.js';
import {
  DATASET_IMPORT_SUB_BATCH_SIZE,
  readDatasetImportChunkRecordBatches,
  readDatasetImportChunkRecords,
  readDatasetImportChunkRecordsFromStream,
} from '../data/dataset-import-chunk.reader.js';

export interface DatasetImportChunkPayloadReader {
  readBatches(payloadPath: string, expectedHash: string): AsyncIterable<CsvRecord[]>;
  readRecords(payloadPath: string, expectedHash: string): AsyncIterable<CsvRecord>;
}

export function createDatasetImportChunkPayloadReader(client: S3Client, bucket: string): DatasetImportChunkPayloadReader {
  return {
    readBatches: async function* (payloadPath, expectedHash) {
      if (payloadPath.startsWith('/')) {
        yield* readDatasetImportChunkRecordBatches(payloadPath, expectedHash);
        return;
      }

      let batch: CsvRecord[] = [];
      for await (const record of readRemoteRecords(client, bucket, payloadPath, expectedHash)) {
        batch.push(record);
        if (batch.length === DATASET_IMPORT_SUB_BATCH_SIZE) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length > 0) yield batch;
    },
    readRecords: (payloadPath, expectedHash) => payloadPath.startsWith('/')
      ? readDatasetImportChunkRecords(payloadPath, expectedHash)
      : readRemoteRecords(client, bucket, payloadPath, expectedHash),
  };
}

async function* readRemoteRecords(client: S3Client, bucket: string, objectKey: string, expectedHash: string): AsyncGenerator<CsvRecord> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!response.Body) throw new Error('O payload normalizado não possui conteúdo.');
  yield* readDatasetImportChunkRecordsFromStream(response.Body as import('node:stream').Readable, expectedHash);
}
