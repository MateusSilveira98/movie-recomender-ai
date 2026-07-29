import express from 'express';
import type { DatasetImportQueue } from '@pkg/recommender';
import { createDatasetImportsRoutes } from '../domains/dataset-imports/routes/dataset-imports.routes.js';
import { createMoviesRoutes } from '../domains/movies/routes/movies.routes.js';
import { createSessionsRoutes } from '../domains/sessions/routes/sessions.routes.js';
import type { SessionRepository } from '../domains/sessions/repositories/sessions.repository.js';

interface AppRouterDependencies {
  datasetImportQueue: DatasetImportQueue;
  sessionRepository: SessionRepository;
}

export function createAppRouter({ datasetImportQueue, sessionRepository }: AppRouterDependencies): express.Router {
  const router = express.Router();

  router.use(createMoviesRoutes());
  router.use(createSessionsRoutes({ sessionRepository }));
  router.use(createDatasetImportsRoutes(datasetImportQueue));

  return router;
}
