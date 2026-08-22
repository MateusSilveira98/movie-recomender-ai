import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { logger } from '@pkg/logger';
import { startObservability } from '@pkg/observability';
import { materializeDatasetImportChunks } from './workers/dataset/infrastructure/data/dataset-import-chunk-materializer.service.js';
import { hasValidUtf8Encoding, readCsvHeader } from './workers/dataset/infrastructure/data/csv.reader.js';
import { validateDatasetHeaders } from './workers/dataset/infrastructure/validation/dataset-csv.validator.js';
import { consumeRabbitMqDatasetImportCommands, createRabbitMqNormalizedDatasetImportCommandPublisher } from './workers/dataset/infrastructure/messaging/rabbitmq-dataset-import-command.adapter.js';
import { createDatasetImportStatusStore } from './workers/dataset/infrastructure/storage/dataset-import-status.store.js';
import type { DatasetImportCommand } from './workers/dataset/domain/dataset-import-command.types.js';
import type { DatasetImportPipelineStage } from './workers/dataset/domain/dataset-import-status.types.js';

const rabbitMqUrl = requiredEnvironment('RABBITMQ_URL');
const storage = createStorage();
const publisher = createRabbitMqNormalizedDatasetImportCommandPublisher(rabbitMqUrl);

void startObservability({ serviceName: 'dataset-import-reader' })
  .then(() => consumeRabbitMqDatasetImportCommands(rabbitMqUrl, { process: processCommand }))
  .catch((error: unknown) => {
    logger.error({ component: 'dataset-import-reader', error: error instanceof Error ? error.name : 'UnknownError', event: 'worker_failed' });
    process.exitCode = 1;
  });

async function processCommand(command: DatasetImportCommand): Promise<void> {
  const directory = join(requiredEnvironment('UPLOAD_STORAGE_DIR'), 'reader-normalized', command.uploadId);
  const sourcePath = join(directory, 'source.csv');
  await updateStatus(command, 'normalizing');
  await mkdir(directory, { recursive: true });

  try {
    await download(storage.client, storage.bucket, command.objectKey, sourcePath);
    const downloadedSize = (await stat(sourcePath)).size;
    if (downloadedSize !== command.sizeBytes) {
      throw new RetryableDatasetImportError('O tamanho do arquivo baixado não corresponde ao upload aceito.');
    }
    if (!await hasValidUtf8Encoding(sourcePath)) {
      throw new NonRetryableDatasetImportError('O arquivo não usa UTF-8 válido.');
    }
    if (validateDatasetHeaders(command.type, await readCsvHeader(sourcePath)).length > 0) {
      throw new NonRetryableDatasetImportError('O cabeçalho do CSV é inválido.');
    }

    let normalizedChunks = 0;
    const pendingCommands: import('./workers/dataset/domain/dataset-import-command.types.js').NormalizedDatasetImportCommand[] = [];
    await materializeDatasetImportChunks(sourcePath, directory, async (chunk) => {
      const objectKey = `dataset-imports/normalized/${command.uploadId}/chunk-${chunk.sequence}.jsonl`;
      const size = (await stat(chunk.payloadPath)).size;
      await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: createReadStream(chunk.payloadPath), ContentLength: size, ContentType: 'application/x-ndjson' }));
      normalizedChunks += 1;
      pendingCommands.push({ ...command, completed: false, chunks: [{ ...chunk, payloadPath: objectKey }], normalizedChunkCount: 0 });
      await unlink(chunk.payloadPath);
      if (pendingCommands.length === 25) await publisher.publishMany(pendingCommands.splice(0));
    }, chunkSize());

    await publisher.publishMany(pendingCommands);
    await updateStatus(command, 'normalized', normalizedChunks);
    await publisher.publish({ ...command, completed: true, chunks: [], normalizedChunkCount: normalizedChunks });
  } catch (error) {
    if (error instanceof NonRetryableDatasetImportError) {
      await updateStatus(command, 'error', null, error.message);
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function updateStatus(command: DatasetImportCommand, stage: DatasetImportPipelineStage, normalizedChunks: number | null = null, errorMessage: string | null = null): Promise<void> {
  const existing = await storage.statusStore.get(command.uploadId);
  await storage.statusStore.put({
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    errorMessage,
    fileName: command.fileName,
    id: command.uploadId,
    normalizedChunks,
    sizeBytes: command.sizeBytes,
    stage,
    type: command.type,
    updatedAt: new Date().toISOString(),
  });
}

function chunkSize(): number | undefined {
  const value = Number(process.env.DATASET_IMPORT_CHUNK_RECORD_COUNT);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function download(client: S3Client, bucket: string, objectKey: string, destination: string): Promise<void> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!response.Body) throw new RetryableDatasetImportError('O objeto de importação não possui conteúdo.');
  await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destination, { flags: 'w' }));
}

function createStorage() {
  const bucket = requiredEnvironment('DATASET_IMPORT_STORAGE_BUCKET');
  const client = new S3Client({ credentials: { accessKeyId: requiredEnvironment('DATASET_IMPORT_STORAGE_ACCESS_KEY'), secretAccessKey: requiredEnvironment('DATASET_IMPORT_STORAGE_SECRET_KEY') }, endpoint: requiredEnvironment('DATASET_IMPORT_STORAGE_ENDPOINT'), forcePathStyle: process.env.DATASET_IMPORT_STORAGE_FORCE_PATH_STYLE !== 'false', region: process.env.DATASET_IMPORT_STORAGE_REGION ?? 'us-east-1' });
  return { bucket, client, statusStore: createDatasetImportStatusStore(client, bucket) };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} precisa ser configurada para o leitor de imports.`);
  return value;
}

class RetryableDatasetImportError extends Error {}
class NonRetryableDatasetImportError extends Error {
  readonly nonRetryable = true;
}
