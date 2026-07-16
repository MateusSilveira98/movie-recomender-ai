import { getRecommendations } from '../../../../../../packages/recommender/src/index.js';
import type { CreateSessionRequest } from '../../../../../../packages/shared/src/entities/models/create-session-request.model.js';
import type { Recommendation } from '../../../../../../packages/shared/src/entities/models/recommendation.model.js';
import type { Session } from '../../../../../../packages/shared/src/entities/models/session.model.js';
import type { SessionFeedbackRequest } from '../../../../../../packages/shared/src/entities/models/session-feedback-request.model.js';
import type { SessionRepository } from '../repositories/sessions.repository.js';
import { applyFeedbackToHistory } from './session-feedback.service.js';
import { generateSessionId } from './session-id.service.js';

export interface SessionsService {
  create(request: CreateSessionRequest): Session;
  findRecommendations(sessionId: string): { recommendations: Recommendation[]; sessionId: string } | null;
  applyFeedback(sessionId: string, request: SessionFeedbackRequest): Session | null;
}

export function createSessionsService(sessionRepository: SessionRepository): SessionsService {
  return {
    create(request) {
      const session: Session = {
        id: generateSessionId(),
        preferences: request.preferences,
        history: request.history ?? { watched: [], liked: [], disliked: [] },
        createdAt: new Date().toISOString(),
      };

      sessionRepository.create(session);

      return session;
    },
    findRecommendations(sessionId) {
      const session = sessionRepository.findById(sessionId);

      if (!session) {
        return null;
      }

      return {
        sessionId: session.id,
        recommendations: getRecommendations(session.preferences, session.history),
      };
    },
    applyFeedback(sessionId, request) {
      const session = sessionRepository.findById(sessionId);

      if (!session) {
        return null;
      }

      const updatedSession: Session = {
        ...session,
        history: applyFeedbackToHistory(session.history, request.movieId, request.feedback),
      };

      sessionRepository.save(updatedSession);

      return updatedSession;
    },
  };
}
