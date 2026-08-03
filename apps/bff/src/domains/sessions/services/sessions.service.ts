import { randomUUID } from 'node:crypto';
import { getRecommendations } from '@pkg/recommender';
import type { AnonymousProfile } from '@pkg/shared/entities/models/anonymous-profile.model';
import type { CreateSessionRequest } from '@pkg/shared/entities/models/create-session-request.model';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { RecommendationRound } from '@pkg/shared/entities/models/recommendation-round.model';
import type { Session } from '@pkg/shared/entities/models/session.model';
import type { SessionFeedbackRequest } from '@pkg/shared/entities/models/session-feedback-request.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { MovieCatalogRepository } from '../../movies/repositories/movies.repository.js';
import type { StoredAnonymousProfile, StoredRecommendationRound, StoredSession, SessionRepository } from '../repositories/sessions.repository.js';
import { applyFeedbackToHistory } from './session-feedback.service.js';
import { generateSessionId } from './session-id.service.js';

const RANKING_VERSION = 'heuristic-v1';
const ROUND_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;

export class InvalidSessionInputError extends Error {
  constructor() {
    super('A seleção contém filmes inválidos.');
  }
}

export interface SessionState {
  profile: AnonymousProfile;
  recommendations: Recommendation[];
  session: Session | null;
}

export interface CurrentSessionState extends SessionState {
  rounds: RecommendationRound[];
}

export interface SessionsService {
  applyFeedback(profile: StoredAnonymousProfile, request: SessionFeedbackRequest): Promise<SessionState | null>;
  create(profile: StoredAnonymousProfile, request: CreateSessionRequest): Promise<SessionState>;
  findCurrent(profile: StoredAnonymousProfile): Promise<CurrentSessionState>;
  findRecommendations(profile: StoredAnonymousProfile): Promise<SessionState | null>;
}

export function createSessionsService(
  sessionRepository: SessionRepository,
  movieCatalogRepository: MovieCatalogRepository,
): SessionsService {
  return {
    async applyFeedback(profile, request) {
      const nowMs = Date.now();
      const session = await sessionRepository.findActiveSession(profile.id, nowMs);

      if (!session) {
        return null;
      }

      const target = await sessionRepository.findFeedbackTarget(profile.id, session.id, request.impressionId, nowMs);

      if (!target) {
        return null;
      }

      const [profileState, catalog] = await Promise.all([
        sessionRepository.findProfileState(profile.id),
        movieCatalogRepository.list(),
      ]);
      const history = applyFeedbackToHistory(session.history, target.movieId, request.feedback);
      const nextProfile: AnonymousProfile = {
        history: applyFeedbackToHistory(profileState.history, target.movieId, request.feedback),
        preferences: profileState.preferences,
      };
      const expiresAtMs = nowMs + SESSION_TTL_MS;
      const updatedSession: StoredSession = { ...session, expiresAtMs, history };

      await sessionRepository.recordFeedback(request.impressionId, request.feedback, nowMs);
      await sessionRepository.saveProfileState(profile.id, nextProfile, nowMs);

      if (!(await sessionRepository.saveSessionState(updatedSession, expiresAtMs, nowMs))) {
        return null;
      }

      const recommendations = await createRecommendations(sessionRepository, catalog, updatedSession, nowMs);

      return { profile: nextProfile, recommendations, session: toPublicSession(updatedSession) };
    },
    async create(profile, request) {
      const nowMs = Date.now();
      const [catalog, profileState] = await Promise.all([
        movieCatalogRepository.list(),
        sessionRepository.findProfileState(profile.id),
      ]);
      const incomingHistory = request.history ?? emptyHistory();
      assertKnownMovieIds(catalog.map((movie) => movie.id), incomingHistory);
      const nextProfile: AnonymousProfile = {
        history: mergeHistory(profileState.history, incomingHistory),
        preferences: { ...request.preferences, freeText: '' },
      };
      const createdAt = new Date(nowMs).toISOString();
      await sessionRepository.abandonActiveSessions(profile.id, nowMs);
      const session: StoredSession = await sessionRepository.createSession({
        candidateCount: catalog.filter((movie) => !nextProfile.history.watched.includes(movie.id)).length,
        createdAt,
        expiresAtMs: nowMs + SESSION_TTL_MS,
        history: nextProfile.history,
        id: generateSessionId(),
        preferences: request.preferences,
        profileId: profile.id,
        rankingVersion: RANKING_VERSION,
        roundId: randomUUID(),
      });

      await sessionRepository.saveProfileState(profile.id, nextProfile, nowMs);

      const recommendations = await createRecommendations(sessionRepository, catalog, session, nowMs);

      return { profile: nextProfile, recommendations, session: toPublicSession(session) };
    },
    async findCurrent(profile) {
      const nowMs = Date.now();
      const [profileState, session, storedRounds, catalog] = await Promise.all([
        sessionRepository.findProfileState(profile.id),
        sessionRepository.findActiveSession(profile.id, nowMs),
        sessionRepository.findRecentRounds(profile.id, nowMs - ROUND_RETENTION_MS),
        movieCatalogRepository.list(),
      ]);
      const rounds = toRecommendationRounds(storedRounds, catalog);

      if (!session) {
        return { profile: profileState, recommendations: [], rounds, session: null };
      }

      const expiresAtMs = nowMs + SESSION_TTL_MS;

      if (!(await sessionRepository.touchSession(session.id, profile.id, nowMs, expiresAtMs))) {
        return { profile: profileState, recommendations: [], rounds, session: null };
      }

      const refreshedSession = { ...session, expiresAtMs };
      const recommendations = await createRecommendations(sessionRepository, catalog, refreshedSession, nowMs);

      return { profile: profileState, recommendations, rounds, session: toPublicSession(refreshedSession) };
    },
    async findRecommendations(profile) {
      const nowMs = Date.now();
      const session = await sessionRepository.findActiveSession(profile.id, nowMs);

      if (!session) {
        return null;
      }

      const expiresAtMs = nowMs + SESSION_TTL_MS;

      if (!(await sessionRepository.touchSession(session.id, profile.id, nowMs, expiresAtMs))) {
        return null;
      }

      const refreshedSession = { ...session, expiresAtMs };
      const [catalog, profileState] = await Promise.all([
        movieCatalogRepository.list(),
        sessionRepository.findProfileState(profile.id),
      ]);
      const recommendations = await createRecommendations(sessionRepository, catalog, refreshedSession, nowMs);

      return { profile: profileState, recommendations, session: toPublicSession(refreshedSession) };
    },
  };
}

async function createRecommendations(
  sessionRepository: SessionRepository,
  catalog: Movie[],
  session: StoredSession,
  nowMs: number,
): Promise<Recommendation[]> {
  const recommendations = getRecommendations(catalog, session.preferences, session.history);

  return sessionRepository.recordImpressions(session.roundId, recommendations, nowMs);
}

function toRecommendationRounds(rounds: StoredRecommendationRound[], catalog: Movie[]): RecommendationRound[] {
  return rounds.map((round) => ({
    ...round,
    recommendations: getRecommendations(catalog, round.preferences, round.history),
  }));
}

function assertKnownMovieIds(catalogMovieIds: string[], history: ViewerHistory): void {
  const knownMovieIds = new Set(catalogMovieIds);
  const movieIds = [...history.watched, ...history.liked, ...history.disliked];

  if (movieIds.some((movieId) => !knownMovieIds.has(movieId))) {
    throw new InvalidSessionInputError();
  }
}

function emptyHistory(): ViewerHistory {
  return { disliked: [], liked: [], watched: [] };
}

function mergeHistory(current: ViewerHistory, incoming: ViewerHistory): ViewerHistory {
  const watched = new Set([...current.watched, ...incoming.watched]);
  const liked = new Set(current.liked);
  const disliked = new Set(current.disliked);

  for (const movieId of incoming.liked) {
    watched.add(movieId);
    liked.add(movieId);
    disliked.delete(movieId);
  }

  for (const movieId of incoming.disliked) {
    watched.add(movieId);
    disliked.add(movieId);
    liked.delete(movieId);
  }

  return { disliked: Array.from(disliked), liked: Array.from(liked), watched: Array.from(watched) };
}

function toPublicSession(session: StoredSession): Session {
  return {
    createdAt: session.createdAt,
    history: session.history,
    preferences: session.preferences,
  };
}
