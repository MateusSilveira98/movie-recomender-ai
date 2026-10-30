import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DatasetImportCommand, DatasetImportQueue } from '@pkg/recommender';
import { datasetImportUploadObjectKey, resolveDatasetImportStoragePrefix, sanitizeDatasetImportFileName } from '@pkg/recommender';
import { logger } from '@pkg/logger';
import { resolveSecretEnvironmentValue } from '@pkg/shared/data-access/services/config-services/secret-environment.service';

export interface DatasetImportCommandStorage {
  download(command: DatasetImportCommand, destination: string): Promise<void>;
  upload(command: DatasetImportCommand, source: string): Promise<void>;
}

export function createQstashDatasetImportStorage(): DatasetImportCommandStorage {
  return createStorage();
}

export function createQstashDatasetImportCommandProcessor(
  queue: DatasetImportQueue,
  storage?: DatasetImportCommandStorage,
): (command: DatasetImportCommand) => Promise<void> {
  return async (command) => {
    const commandStorage = storage ?? createStorage();
    const storagePath = command.localFilePath
      ?? join(tmpdir(), 'movie-recommender-qstash-imports', command.uploadId, 'source.csv');

    logger.info({
      component: 'dataset-import-processor',
      event: 'processing_command',
      fileName: command.fileName,
      hasLocalFile: Boolean(command.localFilePath),
      type: command.type,
      uploadId: command.uploadId,
    });

    if (command.localFilePath) {
      const localSize = (await stat(command.localFilePath)).size;
      if (localSize !== command.sizeBytes) {
        throw new Error('O tamanho do arquivo local não corresponde ao upload aceito.');
      }

      logger.info({
        component: 'dataset-import-processor',
        event: 'r2_upload_start',
        fileName: command.fileName,
        sizeBytes: command.sizeBytes,
        type: command.type,
        uploadId: command.uploadId,
      });

      await commandStorage.upload(command, command.localFilePath);

      logger.info({
        component: 'dataset-import-processor',
        event: 'r2_upload_done',
        fileName: command.fileName,
        type: command.type,
        uploadId: command.uploadId,
      });
    } else {
      await mkdir(join(storagePath, '..'), { recursive: true });
      await commandStorage.download(command, storagePath);

      const downloadedSize = (await stat(storagePath)).size;
      if (downloadedSize !== command.sizeBytes) {
        throw new Error('O tamanho do arquivo baixado não corresponde ao upload aceito.');
      }
    }

    const objectKey = command.objectKey.length > 0
      ? command.objectKey
      : datasetImportUploadObjectKey(resolveDatasetImportStoragePrefix(), command.uploadId, sanitizeDatasetImportFileName(command.fileName));

    logger.info({
      component: 'dataset-import-processor',
      event: 'enqueue_job',
      fileName: command.fileName,
      type: command.type,
      uploadId: command.uploadId,
    });

    await queue.enqueue({
      fileName: command.fileName,
      objectKey,
      sizeBytes: command.sizeBytes,
      storagePath,
      type: command.type,
      uploadId: command.uploadId,
    });

    logger.info({
      component: 'dataset-import-processor',
      event: 'process_pending',
      fileName: command.fileName,
      type: command.type,
      uploadId: command.uploadId,
    });

    await queue.processPending();

    if (command.localFilePath) {
      await unlink(command.localFilePath).catch(() => undefined);
    }

    logger.info({
      component: 'dataset-import-processor',
      event: 'command_completed',
      fileName: command.fileName,
      type: command.type,
      uploadId: command.uploadId,
    });
  };
}

function createStorage(): DatasetImportCommandStorage {
  const bucket = requiredEnvironment('DATASET_IMPORT_STORAGE_BUCKET');
  const client = new S3Client({
    credentials: {
      accessKeyId: requiredSecretEnvironment('DATASET_IMPORT_STORAGE_ACCESS_KEY'),
      secretAccessKey: requiredSecretEnvironment('DATASET_IMPORT_STORAGE_SECRET_KEY'),
    },
    endpoint: requiredEnvironment('DATASET_IMPORT_STORAGE_ENDPOINT'),
    forcePathStyle: process.env.DATASET_IMPORT_STORAGE_FORCE_PATH_STYLE !== 'false',
    region: process.env.DATASET_IMPORT_STORAGE_REGION ?? 'us-east-1',
  });

  return {
    async download(command, destination) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: command.objectKey }));
      if (!response.Body) throw new Error('O objeto de importação não possui conteúdo.');
      await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destination));
    },
    async upload(command, source) {
      await client.send(new PutObjectCommand({
        Body: createReadStream(source),
        Bucket: bucket,
        ContentType: 'text/csv',
        Key: command.objectKey,
      }));
    },
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} precisa ser configurada para processar imports QStash.`);
  return value;
}

function requiredSecretEnvironment(name: string): string {
  const value = resolveSecretEnvironmentValue(process.env, name);
  if (!value) throw new Error(`${name} precisa ser configurada para processar imports QStash.`);
  return value;
}
