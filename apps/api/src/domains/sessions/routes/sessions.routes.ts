import express from 'express';
import {
  createCreateSessionController,
  createSessionFeedbackController,
  createSessionRecommendationsController,
} from '../controllers/sessions.controller.js';
import type { SessionRepository } from '../repositories/sessions.repository.js';
import { createSessionsService } from '../services/sessions.service.js';

interface SessionsRoutesDependencies {
  sessionRepository: SessionRepository;
}

export function createSessionsRoutes({ sessionRepository }: SessionsRoutesDependencies): express.Router {
  const router = express.Router();
  const sessionsService = createSessionsService(sessionRepository);

  router.post('/sessions', createCreateSessionController(sessionsService));
  router.post('/sessions/:sessionId/recommendations', createSessionRecommendationsController(sessionsService));
  router.post('/sessions/:sessionId/feedback', createSessionFeedbackController(sessionsService));

  return router;
}
