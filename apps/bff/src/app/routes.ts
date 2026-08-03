import express from 'express';
import type { DatasetImportQueue } from '@pkg/recommender';
import { createDatasetImportsRoutes } from '../domains/dataset-imports/routes/dataset-imports.routes.js';
import { createMoviesRoutes } from '../domains/movies/routes/movies.routes.js';
import type { MovieCatalogRepository } from '../domains/movies/repositories/movies.repository.js';
import { createSessionsRoutes } from '../domains/sessions/routes/sessions.routes.js';
import type { SessionRepository } from '../domains/sessions/repositories/sessions.repository.js';

interface AppRouterDependencies {
  datasetImportQueue: DatasetImportQueue;
  movieCatalogRepository: MovieCatalogRepository;
  sessionRepository: SessionRepository;
}

export function createAppRouter({ datasetImportQueue, movieCatalogRepository, sessionRepository }: AppRouterDependencies): express.Router {
  const router = express.Router();

  router.use(createMoviesRoutes(movieCatalogRepository));
  router.use(createSessionsRoutes({ movieCatalogRepository, sessionRepository }));
  router.use(createDatasetImportsRoutes(datasetImportQueue));

  return router;
}
