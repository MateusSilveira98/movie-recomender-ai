import express from 'express';
import {
  createCurrentSessionController,
  createCreateSessionController,
  createSessionFeedbackController,
  createSessionRecommendationsController,
} from '../controllers/sessions.controller.js';
import type { MovieCatalogRepository } from '../../movies/repositories/movies.repository.js';
import type { SessionRepository } from '../repositories/sessions.repository.js';
import { createAnonymousProfileService } from '../services/anonymous-profile.service.js';
import { createSessionsService } from '../services/sessions.service.js';

interface SessionsRoutesDependencies {
  movieCatalogRepository: MovieCatalogRepository;
  sessionRepository: SessionRepository;
}

export function createSessionsRoutes({ movieCatalogRepository, sessionRepository }: SessionsRoutesDependencies): express.Router {
  const router = express.Router();
  const sessionsService = createSessionsService(sessionRepository, movieCatalogRepository);
  const anonymousProfileService = createAnonymousProfileService(sessionRepository);

  router.get('/sessions/current', createCurrentSessionController(sessionsService, anonymousProfileService));
  router.post('/sessions', createCreateSessionController(sessionsService, anonymousProfileService));
  router.post('/sessions/recommendations', createSessionRecommendationsController(sessionsService, anonymousProfileService));
  router.post('/sessions/feedback', createSessionFeedbackController(sessionsService, anonymousProfileService));

  return router;
}
