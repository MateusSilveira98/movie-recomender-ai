import cors from 'cors';
import express from 'express';
import type { Client } from '@libsql/client';
import { createDatabaseClient, getDatabaseHealth } from '@pkg/database';
import { logger } from '@pkg/logger';
import { getTrainingPipelineStatus, type ModelRuntimeStatus } from '@pkg/ml';
import { createDatasetImportQueue, createRecommendationRanker, createSqlDatasetImportGateway, getQstashConfiguration, type DatasetImportCommand, type QstashConfiguration, type RecommendationRanker } from '@pkg/recommender';
import { getHealthMessage } from '@pkg/shared/data-access/services/api-services/health';
import { resolveSecretEnvironmentValue } from '@pkg/shared/data-access/services/config-services/secret-environment.service';
import { createQstashDatasetImportRoutes } from '../domains/dataset-imports/routes/qstash-dataset-imports.routes.js';
import type { DatasetImportQueue, StoredDatasetImportJob } from '@pkg/recommender';
import { createQstashDatasetImportCommandProcessor, createQstashDatasetImportStorage } from '../domains/dataset-imports/data-access/qstash-dataset-import-command-processor.service.js';
import { createSqlMovieCatalogRepository } from '../domains/movies/repositories/movies.repository.js';
import { createSqlSessionRepository } from '../domains/sessions/repositories/sessions.repository.js';
import { createAsyncHandler, createRequestLogger, requestErrorHandler } from '../middlewares/request-logger.middleware.js';
import { createAppRouter } from './routes.js';
import { isAllowedWebOrigin } from './web-origin.js';

interface AppDependencies {
  databaseClient?: Client;
  datasetImportAdminToken?: string;
  datasetImportCommandProcessor?: (command: DatasetImportCommand) => Promise<void>;
  datasetImportQueue?: DatasetImportQueue;
  datasetImportRehydrateFile?: (job: StoredDatasetImportJob) => Promise<string>;
  mlStatus?: ModelRuntimeStatus;
  processDatasetQueue?: boolean;
  qstash?: QstashConfiguration | null;
  recommendationRanker?: RecommendationRanker;
}

function createRehydrateFile(storageFactory: () => { download(command: DatasetImportCommand, destination: string): Promise<void> }) {
  return async (job: StoredDatasetImportJob): Promise<string> => {
    if (!job.objectKey) throw new Error('O objectKey do upload não está persistido.');
    const path = `/tmp/movie-recommender-qstash-imports/${job.uploadId}/source.csv`;
    await (await import('node:fs/promises')).mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await storageFactory().download({ fileName: job.fileName, objectKey: job.objectKey, sizeBytes: job.sizeBytes, type: job.type, uploadId: job.uploadId }, path);
    return path;
  };
}

export function createApp({
  databaseClient = createDatabaseClient(),
  datasetImportAdminToken = resolveSecretEnvironmentValue(process.env, 'DATASET_IMPORT_ADMIN_TOKEN'),
  datasetImportCommandProcessor,
  datasetImportQueue: providedDatasetImportQueue,
  datasetImportRehydrateFile,
  mlStatus = getTrainingPipelineStatus(),
  processDatasetQueue = true,
  qstash = getQstashConfiguration(),
  recommendationRanker = createRecommendationRanker(),
}: AppDependencies = {}): express.Express {
  const app = express();
  const datasetImportQueue = providedDatasetImportQueue ?? createDatasetImportQueue(
    createSqlDatasetImportGateway(databaseClient),
    undefined,
    { autoProcess: processDatasetQueue && !qstash, rehydrateFile: datasetImportRehydrateFile ?? (qstash ? createRehydrateFile(() => createQstashDatasetImportStorage()) : undefined) },
  );
  const qstashCommandProcessor = datasetImportCommandProcessor
    ?? (qstash ? createQstashDatasetImportCommandProcessor(datasetImportQueue) : undefined);
  const movieCatalogRepository = createSqlMovieCatalogRepository(databaseClient);
  const sessionRepository = createSqlSessionRepository(databaseClient);

  app.use((request, response, next) => {
    const origin = request.get('origin');

    if (origin && !isAllowedWebOrigin(origin)) {
      response.status(403).json({ error: 'Origem nao autorizada.' });
      return;
    }

    next();
  });
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || isAllowedWebOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
    }),
  );
  app.use(createQstashDatasetImportRoutes(qstash, datasetImportQueue, qstashCommandProcessor));
  app.use(express.json());
  app.use(createRequestLogger());

  app.get('/health', createAsyncHandler(async (_request, response) => {
    response.json({
      status: 'ok',
      message: getHealthMessage('bff'),
      database: await getDatabaseHealth(),
      ml: mlStatus,
    });
  }));

  app.use(createAppRouter({ datasetImportAdminToken, datasetImportQueue, movieCatalogRepository, recommendationRanker, sessionRepository }));
  app.use(requestErrorHandler);

  if (processDatasetQueue) {
    void datasetImportQueue.processPending();
  }
  void sessionRepository.cleanupExpired(Date.now()).catch((error: unknown) => {
    logger.error({
      component: 'bff',
      error: error instanceof Error ? error.name : 'UnknownError',
      event: 'session_cleanup_failed',
    });
  });

  return app;
}
