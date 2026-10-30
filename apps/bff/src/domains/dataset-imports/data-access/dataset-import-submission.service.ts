import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  createDatasetImportCommandPublisher,
  createDatasetImportStatusStore,
  datasetImportUploadObjectKey,
  getQstashConfiguration,
  resolveDatasetImportStoragePrefix,
  type DatasetFileType,
  type DatasetImportCommand,
} from '@pkg/recommender';
import { logger } from '@pkg/logger';
import { resolveSecretEnvironmentValue } from '@pkg/shared/data-access/services/config-services/secret-environment.service';

export interface DatasetImportSubmissionInput {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  type: DatasetFileType;
}

export interface DatasetImportSubmission {
  fileName: string;
  id: string;
  sizeBytes: number;
  status: 'accepted';
  type: DatasetFileType;
}

export async function submitDatasetImport(input: DatasetImportSubmissionInput): Promise<DatasetImportSubmission> {
  const id = crypto.randomUUID();
  const storage = createStorage();
  const objectKey = datasetImportUploadObjectKey(storage.prefix, id, input.fileName);
  const qstash = getQstashConfiguration();

  if (qstash) {
    return submitAsync(input, id, objectKey, storage, qstash);
  }

  return submitSync(input, id, objectKey, storage);
}

async function submitAsync(
  input: DatasetImportSubmissionInput,
  id: string,
  objectKey: string,
  storage: ReturnType<typeof createStorage>,
  _qstash: NonNullable<ReturnType<typeof getQstashConfiguration>>,
): Promise<DatasetImportSubmission> {
  logger.info({
    component: 'dataset-import-submission',
    event: 'upload_accepted',
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    type: input.type,
    uploadId: id,
  });

  await storage.statusStore.put({
    createdAt: new Date().toISOString(),
    errorMessage: null,
    fileName: input.fileName,
    id,
    normalizedChunks: null,
    sizeBytes: input.sizeBytes,
    stage: 'accepted',
    type: input.type,
    updatedAt: new Date().toISOString(),
  });

  const command: DatasetImportCommand = {
    fileName: input.fileName,
    localFilePath: input.filePath,
    objectKey,
    sizeBytes: input.sizeBytes,
    type: input.type,
    uploadId: id,
  };

  try {
    await storage.publisher.publish(command);
    logger.info({
      component: 'dataset-import-submission',
      event: 'command_published',
      fileName: input.fileName,
      type: input.type,
      uploadId: id,
    });
  } catch (error) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey })).catch(() => undefined);
    await unlink(input.filePath).catch(() => undefined);
    throw error;
  }

  return { fileName: input.fileName, id, sizeBytes: input.sizeBytes, status: 'accepted', type: input.type };
}

async function submitSync(
  input: DatasetImportSubmissionInput,
  id: string,
  objectKey: string,
  storage: ReturnType<typeof createStorage>,
): Promise<DatasetImportSubmission> {
  logger.info({
    component: 'dataset-import-submission',
    event: 'upload_accepted',
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    type: input.type,
    uploadId: id,
  });

  try {
    await storage.client.send(new PutObjectCommand({
      Body: createReadStream(input.filePath),
      Bucket: storage.bucket,
      ContentType: 'text/csv',
      Key: objectKey,
    }));
    await storage.statusStore.put({
      createdAt: new Date().toISOString(),
      errorMessage: null,
      fileName: input.fileName,
      id,
      normalizedChunks: null,
      sizeBytes: input.sizeBytes,
      stage: 'accepted',
      type: input.type,
      updatedAt: new Date().toISOString(),
    });
    await storage.publisher.publish({ fileName: input.fileName, objectKey, sizeBytes: input.sizeBytes, type: input.type, uploadId: id });
    logger.info({
      component: 'dataset-import-submission',
      event: 'command_published',
      fileName: input.fileName,
      type: input.type,
      uploadId: id,
    });
  } catch (error) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey })).catch(() => undefined);
    throw error;
  } finally {
    await unlink(input.filePath).catch(() => undefined);
  }

  return { fileName: input.fileName, id, sizeBytes: input.sizeBytes, status: 'accepted', type: input.type };
}

function createStorage() {
  const bucket = requiredEnvironment('DATASET_IMPORT_STORAGE_BUCKET');
  const prefix = resolveDatasetImportStoragePrefix();
  const client = new S3Client({
    credentials: {
      accessKeyId: requiredEnvironment('DATASET_IMPORT_STORAGE_ACCESS_KEY'),
      secretAccessKey: requiredEnvironment('DATASET_IMPORT_STORAGE_SECRET_KEY'),
    },
    endpoint: requiredEnvironment('DATASET_IMPORT_STORAGE_ENDPOINT'),
    forcePathStyle: process.env.DATASET_IMPORT_STORAGE_FORCE_PATH_STYLE !== 'false',
    region: process.env.DATASET_IMPORT_STORAGE_REGION ?? 'us-east-1',
  });

  return {
    bucket,
    client,
    prefix,
    publisher: createDatasetImportCommandPublisher(),
    statusStore: createDatasetImportStatusStore(client, bucket, prefix),
  };
}

function requiredEnvironment(name: string): string {
  const value = name === 'DATASET_IMPORT_STORAGE_ACCESS_KEY' || name === 'DATASET_IMPORT_STORAGE_SECRET_KEY'
    ? resolveSecretEnvironmentValue(process.env, name)
    : process.env[name]?.trim();
  if (!value) throw new Error(`${name} precisa ser configurada para importar datasets.`);
  return value;
}
