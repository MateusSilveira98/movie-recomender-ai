import cors from 'cors';
import express from 'express';
import type { Client } from '@libsql/client';
import { createDatabaseClient, getDatabaseHealth } from '@pkg/database';
import { getTrainingPipelineStatus, type ModelRuntimeStatus } from '@pkg/ml';
import { createDatasetImportQueue, createRecommendationRanker, createSqlDatasetImportGateway, type RecommendationRanker } from '@pkg/recommender';
import { getHealthMessage } from '@pkg/shared/data-access/services/api-services/health';
import { createSqlMovieCatalogRepository } from '../domains/movies/repositories/movies.repository.js';
import { createSqlSessionRepository } from '../domains/sessions/repositories/sessions.repository.js';
import { createRequestLogger, requestErrorHandler } from '../middlewares/request-logger.middleware.js';
import { createAppRouter } from './routes.js';
import { isAllowedWebOrigin } from './web-origin.js';

interface AppDependencies {
  databaseClient?: Client;
  datasetImportAdminToken?: string;
  mlStatus?: ModelRuntimeStatus;
  processDatasetQueue?: boolean;
  recommendationRanker?: RecommendationRanker;
}

export function createApp({
  databaseClient = createDatabaseClient(),
  datasetImportAdminToken = process.env.DATASET_IMPORT_ADMIN_TOKEN,
  mlStatus = getTrainingPipelineStatus(),
  processDatasetQueue = true,
  recommendationRanker = createRecommendationRanker(),
}: AppDependencies = {}): express.Express {
  const app = express();
  const datasetImportQueue = createDatasetImportQueue(createSqlDatasetImportGateway(databaseClient));
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
  app.use(express.json());
  app.use(createRequestLogger());

  app.get('/health', async (_request, response) => {
    response.json({
      status: 'ok',
      message: getHealthMessage('bff'),
      database: await getDatabaseHealth(),
      ml: mlStatus,
    });
  });

  app.use(createAppRouter({ datasetImportAdminToken, datasetImportQueue, movieCatalogRepository, recommendationRanker, sessionRepository }));
  app.use(requestErrorHandler);

  if (processDatasetQueue) {
    void datasetImportQueue.processPending();
  }
  void sessionRepository.cleanupExpired(Date.now());

  return app;
}
