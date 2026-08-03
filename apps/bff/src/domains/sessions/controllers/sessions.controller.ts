import type { RequestHandler } from 'express';
import { createAsyncHandler } from '../../../middlewares/request-logger.middleware.js';
import type { AnonymousProfileService } from '../services/anonymous-profile.service.js';
import { InvalidSessionInputError, type SessionsService } from '../services/sessions.service.js';
import { validateCreateSessionRequest, validateSessionFeedbackRequest } from '../validators/sessions.validator.js';

export function createCurrentSessionController(
  sessionsService: SessionsService,
  anonymousProfileService: AnonymousProfileService,
): RequestHandler {
  return createAsyncHandler(async (request, response) => {
    const resolvedProfile = await anonymousProfileService.getOrCreate(request, response);
    const state = await sessionsService.findCurrent(resolvedProfile.profile);

    response.json({ ...state, csrfToken: resolvedProfile.csrfToken });
  });
}

export function createCreateSessionController(
  sessionsService: SessionsService,
  anonymousProfileService: AnonymousProfileService,
): RequestHandler {
  return createAsyncHandler(async (request, response) => {
    const resolvedProfile = await anonymousProfileService.requireForMutation(request);

    if (!resolvedProfile) {
      response.status(403).json({ error: 'Nao foi possivel validar a sessao anonima.' });
      return;
    }

    const validation = validateCreateSessionRequest(request.body);

    if (!validation.valid) {
      response.status(400).json({ error: validation.error });
      return;
    }

    try {
      const state = await sessionsService.create(resolvedProfile.profile, validation.data);
      response.status(201).json({ ...state, csrfToken: resolvedProfile.csrfToken });
    } catch (error) {
      if (error instanceof InvalidSessionInputError) {
        response.status(422).json({ error: error.message });
        return;
      }

      throw error;
    }
  });
}

export function createSessionRecommendationsController(
  sessionsService: SessionsService,
  anonymousProfileService: AnonymousProfileService,
): RequestHandler {
  return createAsyncHandler(async (request, response) => {
    const resolvedProfile = await anonymousProfileService.requireForMutation(request);

    if (!resolvedProfile) {
      response.status(403).json({ error: 'Nao foi possivel validar a sessao anonima.' });
      return;
    }

    const state = await sessionsService.findRecommendations(resolvedProfile.profile);

    if (!state) {
      response.status(410).json({ error: 'Sua sessao expirou. Inicie uma nova rodada.' });
      return;
    }

    response.json({ ...state, csrfToken: resolvedProfile.csrfToken });
  });
}

export function createSessionFeedbackController(
  sessionsService: SessionsService,
  anonymousProfileService: AnonymousProfileService,
): RequestHandler {
  return createAsyncHandler(async (request, response) => {
    const resolvedProfile = await anonymousProfileService.requireForMutation(request);

    if (!resolvedProfile) {
      response.status(403).json({ error: 'Nao foi possivel validar a sessao anonima.' });
      return;
    }

    const validation = validateSessionFeedbackRequest(request.body);

    if (!validation.valid) {
      response.status(400).json({ error: validation.error });
      return;
    }

    const state = await sessionsService.applyFeedback(resolvedProfile.profile, validation.data);

    if (!state) {
      response.status(404).json({ error: 'A recomendacao nao esta disponivel nesta sessao.' });
      return;
    }

    response.json({ ...state, csrfToken: resolvedProfile.csrfToken });
  });
}
