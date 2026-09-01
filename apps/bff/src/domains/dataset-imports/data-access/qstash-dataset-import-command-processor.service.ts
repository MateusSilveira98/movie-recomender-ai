import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DatasetImportCommand, DatasetImportQueue } from '@pkg/recommender';
import { resolveSecretEnvironmentValue } from '@pkg/shared/data-access/services/config-services/secret-environment.service';

interface DatasetImportCommandStorage {
  download(command: DatasetImportCommand, destination: string): Promise<void>;
}

export function createQstashDatasetImportCommandProcessor(
  queue: DatasetImportQueue,
  storage?: DatasetImportCommandStorage,
): (command: DatasetImportCommand) => Promise<void> {
  return async (command) => {
    const commandStorage = storage ?? createStorage();
    const storagePath = join(tmpdir(), 'movie-recommender-qstash-imports', command.uploadId, 'source.csv');
    await mkdir(join(storagePath, '..'), { recursive: true });
    await commandStorage.download(command, storagePath);

    const downloadedSize = (await stat(storagePath)).size;
    if (downloadedSize !== command.sizeBytes) {
      throw new Error('O tamanho do arquivo baixado não corresponde ao upload aceito.');
    }

    await queue.enqueue({
      fileName: command.fileName,
      sizeBytes: command.sizeBytes,
      storagePath,
      type: command.type,
      uploadId: command.uploadId,
    });
    await queue.processPending();
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
