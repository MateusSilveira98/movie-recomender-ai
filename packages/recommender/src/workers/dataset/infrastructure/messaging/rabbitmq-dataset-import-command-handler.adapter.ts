import { S3Client } from '@aws-sdk/client-s3';
import type { Client } from '@libsql/client';
import type { DatasetImportChunkDispatcher } from '../../application/ports/dataset-import-chunk-dispatcher.port.js';
import type { NormalizedDatasetImportCommand } from '../../domain/dataset-import-command.types.js';
import { createDatasetImportChunksWithResult } from '../persistence/dataset-import-chunks.repository.js';
import { createDatasetUploadWithJob, findDatasetUpload, startDatasetImportJob } from '../persistence/dataset-import-queue.repository.js';
import { listDatasetImportChunks } from '../persistence/dataset-import-chunks.repository.js';
import { createDatasetImportStatusStore } from '../storage/dataset-import-status.store.js';
import type { NormalizedDatasetImportCommandPublisher } from './rabbitmq-dataset-import-command.adapter.js';

export function createRabbitMqNormalizedDatasetImportCommandHandler(client: Client, dispatcher: DatasetImportChunkDispatcher, publisher: NormalizedDatasetImportCommandPublisher) {
  const storage = createStorage();

  return {
    async process(command: NormalizedDatasetImportCommand): Promise<void> {
      if (!command.completed && command.chunks.length > 1) {
        await publisher.publishMany([
          ...command.chunks.map((chunk) => ({ ...command, completed: false, chunks: [chunk], normalizedChunkCount: 0 })),
          { ...command, completed: true, chunks: [], normalizedChunkCount: command.chunks.length },
        ]);
        return;
      }

      const upload = await findDatasetUpload(client, command.uploadId) ?? await createDatasetUploadWithJob(client, {
        fileName: command.fileName,
        sizeBytes: command.sizeBytes,
        storagePath: command.chunks[0]?.payloadPath ?? null,
        type: command.type,
      }, command.uploadId);

      for (const chunk of command.chunks) {
        await createDatasetImportChunksWithResult(client, upload.jobId, [{
          ...chunk,
          payloadPath: chunk.payloadPath,
        }]);
      }

      if (!command.completed) return;

      await updateStatus(command);
      await startDatasetImportJob(client, { id: upload.jobId, uploadId: upload.id });
      const chunks = await listDatasetImportChunks(client, upload.jobId);
      const messages = chunks.map((chunk) => ({ chunkId: chunk.id, jobId: upload.jobId, type: command.type }));
      if (dispatcher.publishMany) {
        await dispatcher.publishMany(messages);
        return;
      }
      for (const message of messages) await dispatcher.publish(message);
    },
  };

  async function updateStatus(command: NormalizedDatasetImportCommand): Promise<void> {
    const existing = await storage.statusStore.get(command.uploadId);
    await storage.statusStore.put({
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      errorMessage: null,
      fileName: command.fileName,
      id: command.uploadId,
      normalizedChunks: command.normalizedChunkCount,
      sizeBytes: command.sizeBytes,
      stage: 'queued',
      type: command.type,
      updatedAt: new Date().toISOString(),
    });
  }
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
  return { bucket, client, statusStore: createDatasetImportStatusStore(client, bucket) };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} precisa ser configurada para processar imports.`);
  return value;
}
