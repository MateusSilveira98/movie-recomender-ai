import { logger } from '@pkg/logger';
import { createDatabaseClient } from '@pkg/database';
import { startObservability } from '@pkg/observability';
import { createDatasetImportWriteExecutor } from './workers/dataset/application/dataset-import-write-executor.service.js';
import { createSqlDatasetImportCreditChunkHandler, createSqlDatasetImportGateway, createSqlDatasetImportLinkChunkHandler, createSqlDatasetImportMovieChunkHandler, createSqlDatasetImportRatingChunkHandler } from './workers/dataset/infrastructure/dataset-import-queue.adapter.js';
import { consumeRabbitMqDatasetImportChunks } from './workers/dataset/infrastructure/messaging/rabbitmq-dataset-import-chunk-consumer.adapter.js';
import { consumeRabbitMqNormalizedDatasetImportCommands, createRabbitMqNormalizedDatasetImportCommandPublisher } from './workers/dataset/infrastructure/messaging/rabbitmq-dataset-import-command.adapter.js';
import { createRabbitMqNormalizedDatasetImportCommandHandler } from './workers/dataset/infrastructure/messaging/rabbitmq-dataset-import-command-handler.adapter.js';
import { createRabbitMqDatasetImportChunkDispatcher } from './workers/dataset/infrastructure/messaging/rabbitmq-dataset-import-chunk-dispatcher.adapter.js';
import { createDatasetImportChunkPayloadReader } from './workers/dataset/infrastructure/storage/dataset-import-chunk-payload-reader.js';
import { listQueuedDatasetImportChunks } from './workers/dataset/infrastructure/persistence/dataset-import-chunks.repository.js';
import { S3Client } from '@aws-sdk/client-s3';

const client = createDatabaseClient();
const rabbitMqUrl = requiredEnvironment('RABBITMQ_URL');
const dispatcher = createRabbitMqDatasetImportChunkDispatcher(rabbitMqUrl);
const normalizedCommandPublisher = createRabbitMqNormalizedDatasetImportCommandPublisher(rabbitMqUrl);
const gateway = createSqlDatasetImportGateway(client);
const commandHandler = createRabbitMqNormalizedDatasetImportCommandHandler(client, dispatcher, normalizedCommandPublisher);
const payloadReader = createPayloadReader();
const republishedChunkIds = new Set<string>();
const writeExecutor = createDatasetImportWriteExecutor();

async function run(): Promise<void> {
  void recoverAndReconcileContinuously();

  await Promise.all([
    consumeContinuously('normalized-commands', () => consumeRabbitMqNormalizedDatasetImportCommands(rabbitMqUrl, { process: (command) => writeExecutor.execute(() => commandHandler.process(command)) })),
    consumeContinuously('movies', () => consumeRabbitMqDatasetImportChunks(rabbitMqUrl, 'movies', createSqlDatasetImportMovieChunkHandler(client, payloadReader), 3, writeExecutor)),
    consumeContinuously('links', () => consumeRabbitMqDatasetImportChunks(rabbitMqUrl, 'links', createSqlDatasetImportLinkChunkHandler(client, payloadReader), 3, writeExecutor)),
    consumeContinuously('credits', () => consumeRabbitMqDatasetImportChunks(rabbitMqUrl, 'credits', createSqlDatasetImportCreditChunkHandler(client, payloadReader), 3, writeExecutor)),
    consumeContinuously('ratings', () => consumeRabbitMqDatasetImportChunks(rabbitMqUrl, 'ratings', createSqlDatasetImportRatingChunkHandler(client, payloadReader), 3, writeExecutor)),
  ]);
}

async function consumeContinuously(name: string, consume: () => Promise<void>): Promise<never> {
  while (true) {
    try {
      await consume();
    } catch (error) {
      logger.error({
        component: 'dataset-import-writer',
        consumer: name,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        event: 'consumer_connection_failed',
      });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function recoverAndReconcileContinuously(): Promise<void> {
  try {
    await writeExecutor.execute(() => gateway.requeueInterruptedJobs());
  } catch (error) {
    logger.error({
      component: 'dataset-import-writer',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      event: 'interrupted_jobs_requeue_failed',
    });
  }

  while (true) {
    try {
      await writeExecutor.execute(republishQueuedChunks);
      await writeExecutor.execute(() => gateway.reconcileStagedImports());
    } catch (error) {
      logger.error({
        component: 'dataset-import-writer',
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        event: 'reconciliation_failed',
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function republishQueuedChunks(): Promise<void> {
  const chunks = (await listQueuedDatasetImportChunks(client))
    .filter((chunk) => !republishedChunkIds.has(chunk.id));

  if (chunks.length === 0) return;

  await dispatcher.publishMany!(chunks.map((chunk) => ({
    chunkId: chunk.id,
    jobId: chunk.jobId,
    type: chunk.type,
  })));
  chunks.forEach((chunk) => republishedChunkIds.add(chunk.id));
}

function createPayloadReader() {
  const bucket = requiredEnvironment('DATASET_IMPORT_STORAGE_BUCKET');
  return createDatasetImportChunkPayloadReader(new S3Client({
    credentials: { accessKeyId: requiredEnvironment('DATASET_IMPORT_STORAGE_ACCESS_KEY'), secretAccessKey: requiredEnvironment('DATASET_IMPORT_STORAGE_SECRET_KEY') },
    endpoint: requiredEnvironment('DATASET_IMPORT_STORAGE_ENDPOINT'),
    forcePathStyle: process.env.DATASET_IMPORT_STORAGE_FORCE_PATH_STYLE !== 'false',
    region: process.env.DATASET_IMPORT_STORAGE_REGION ?? 'us-east-1',
  }), bucket);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} precisa ser configurada para o escritor de imports.`);
  return value;
}

void startObservability({ serviceName: 'dataset-import-writer' })
  .then(() => run())
  .catch((error: unknown) => {
    logger.error({ component: 'dataset-import-writer', error: error instanceof Error ? error.name : 'UnknownError', event: 'worker_failed' });
    process.exitCode = 1;
  });
