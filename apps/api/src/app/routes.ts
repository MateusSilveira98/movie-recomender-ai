import express from 'express';
import { createMoviesRoutes } from '../domains/movies/routes/movies.routes.js';
import { createSessionsRoutes } from '../domains/sessions/routes/sessions.routes.js';
import type { SessionRepository } from '../domains/sessions/repositories/sessions.repository.js';

interface AppRouterDependencies {
  sessionRepository: SessionRepository;
}

export function createAppRouter({ sessionRepository }: AppRouterDependencies): express.Router {
  const router = express.Router();

  router.use(createMoviesRoutes());
  router.use(createSessionsRoutes({ sessionRepository }));

  return router;
}
