import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createDatasetImportStatusStore, createRabbitMqDatasetImportCommandPublisher, type DatasetFileType } from '@pkg/recommender';

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
  const objectKey = `dataset-imports/${id}/${sanitizeFileName(input.fileName)}`;
  const storage = createStorage();

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
  } catch (error) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey })).catch(() => undefined);
    throw error;
  } finally {
    await unlink(input.filePath).catch(() => undefined);
  }

  const accepted = { fileName: input.fileName, id, sizeBytes: input.sizeBytes, status: 'accepted' as const, type: input.type };
  return accepted;
}

function createStorage() {
  const bucket = requiredEnvironment('DATASET_IMPORT_STORAGE_BUCKET');
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
    publisher: createRabbitMqDatasetImportCommandPublisher(requiredEnvironment('RABBITMQ_URL')),
    statusStore: createDatasetImportStatusStore(client, bucket),
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} precisa ser configurada para importar datasets.`);
  return value;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}
