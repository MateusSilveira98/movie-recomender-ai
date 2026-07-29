import type { RequestHandler } from 'express';
import type { SessionsService } from '../services/sessions.service.js';
import { validateCreateSessionRequest, validateSessionFeedbackRequest } from '../validators/sessions.validator.js';

export function createCreateSessionController(sessionsService: SessionsService): RequestHandler {
  return async (request, response) => {
    const validation = validateCreateSessionRequest(request.body);

    if (!validation.valid) {
      response.status(400).json({ error: validation.error });
      return;
    }

    response.status(201).json({ session: await sessionsService.create(validation.data) });
  };
}

export function createSessionRecommendationsController(sessionsService: SessionsService): RequestHandler {
  return async (request, response) => {
    const result = await sessionsService.findRecommendations(request.params.sessionId);

    if (!result) {
      response.status(404).json({ error: `Sessao ${request.params.sessionId} nao encontrada.` });
      return;
    }

    response.json(result);
  };
}

export function createSessionFeedbackController(sessionsService: SessionsService): RequestHandler {
  return async (request, response) => {
    const validation = validateSessionFeedbackRequest(request.body);

    if (!validation.valid) {
      response.status(400).json({ error: validation.error });
      return;
    }

    const session = await sessionsService.applyFeedback(request.params.sessionId, validation.data);

    if (!session) {
      response.status(404).json({ error: `Sessao ${request.params.sessionId} nao encontrada.` });
      return;
    }

    response.json({ session });
  };
}
