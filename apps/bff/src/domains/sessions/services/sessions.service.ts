import { randomUUID } from 'node:crypto';
import { createRecommendationRanker, type RecommendationRanker } from '@pkg/recommender';
import type { AnonymousProfile } from '@pkg/shared/entities/models/anonymous-profile.model';
import type { CreateSessionRequest } from '@pkg/shared/entities/models/create-session-request.model';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { RecommendationRound } from '@pkg/shared/entities/models/recommendation-round.model';
import type { Session } from '@pkg/shared/entities/models/session.model';
import type { SessionFeedbackRequest } from '@pkg/shared/entities/models/session-feedback-request.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { MovieCatalogRepository } from '../../movies/repositories/movies.repository.js';
import type { StoredAnonymousProfile, StoredRecommendationRound, StoredSession, SessionRepository } from '../repositories/sessions.repository.js';
import { applyFeedbackToHistory } from './session-feedback.service.js';
import { generateSessionId } from './session-id.service.js';

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
  recommendationRanker: RecommendationRanker = createRecommendationRanker(),
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
        movieCatalogRepository.listRankingCandidates(),
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

      const recommendations = await createRecommendations(
        sessionRepository,
        movieCatalogRepository,
        catalog,
        updatedSession,
        nowMs,
        recommendationRanker,
      );

      return { profile: nextProfile, recommendations, session: toPublicSession(updatedSession) };
    },
    async create(profile, request) {
      const nowMs = Date.now();
      const [catalog, profileState] = await Promise.all([
        movieCatalogRepository.listRankingCandidates(),
        sessionRepository.findProfileState(profile.id),
      ]);
      const incomingHistory = request.history ?? emptyHistory();
      assertKnownMovieIds(catalog.map((movie) => movie.id), incomingHistory);
      const nextProfile: AnonymousProfile = {
        history: mergeHistory(profileState.history, incomingHistory),
        preferences: { ...request.preferences, freeText: '' },
      };
      const createdAt = new Date(nowMs).toISOString();
      const ranking = recommendationRanker.rank(catalog, nextProfile.preferences, nextProfile.history);
      await sessionRepository.abandonActiveSessions(profile.id, nowMs);
      const session: StoredSession = await sessionRepository.createSession({
        candidateCount: ranking.candidateCount,
        createdAt,
        expiresAtMs: nowMs + SESSION_TTL_MS,
        history: nextProfile.history,
        id: generateSessionId(),
        modelVersion: ranking.modelVersion,
        preferences: request.preferences,
        profileId: profile.id,
        rankingVersion: ranking.rankingVersion,
        roundId: randomUUID(),
      });

      await sessionRepository.saveProfileState(profile.id, nextProfile, nowMs);

      const recommendations = withMatchPercentages(await sessionRepository.recordImpressions(
        session.roundId,
        await hydrateRecommendations(movieCatalogRepository, ranking.recommendations),
        nowMs,
      ), session.preferences);

      return { profile: nextProfile, recommendations, session: toPublicSession(session) };
    },
    async findCurrent(profile) {
      const nowMs = Date.now();
      const [profileState, session, storedRounds] = await Promise.all([
        sessionRepository.findProfileState(profile.id),
        sessionRepository.findActiveSession(profile.id, nowMs),
        sessionRepository.findRecentRounds(profile.id, nowMs - ROUND_RETENTION_MS),
      ]);

      if (!session && storedRounds.length === 0) {
        return { profile: profileState, recommendations: [], rounds: [], session: null };
      }

      const roundsPromise = toRecommendationRounds(storedRounds, movieCatalogRepository);

      if (!session) {
        return { profile: profileState, recommendations: [], rounds: await roundsPromise, session: null };
      }

      const [rounds, catalog] = await Promise.all([
        roundsPromise,
        movieCatalogRepository.listRankingCandidates(),
      ]);

      const expiresAtMs = nowMs + SESSION_TTL_MS;

      if (!(await sessionRepository.touchSession(session.id, profile.id, nowMs, expiresAtMs))) {
        return { profile: profileState, recommendations: [], rounds, session: null };
      }

      const refreshedSession = { ...session, expiresAtMs };
      const recommendations = await createRecommendations(
        sessionRepository,
        movieCatalogRepository,
        catalog,
        refreshedSession,
        nowMs,
        recommendationRanker,
      );

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
        movieCatalogRepository.listRankingCandidates(),
        sessionRepository.findProfileState(profile.id),
      ]);
      const recommendations = await createRecommendations(
        sessionRepository,
        movieCatalogRepository,
        catalog,
        refreshedSession,
        nowMs,
        recommendationRanker,
      );

      return { profile: profileState, recommendations, session: toPublicSession(refreshedSession) };
    },
  };
}

async function createRecommendations(
  sessionRepository: SessionRepository,
  movieCatalogRepository: MovieCatalogRepository,
  catalog: Movie[],
  session: StoredSession,
  nowMs: number,
  recommendationRanker: RecommendationRanker,
): Promise<Recommendation[]> {
  const ranking = recommendationRanker.rank(catalog, session.preferences, session.history);

  return withMatchPercentages(await sessionRepository.recordImpressions(
    session.roundId,
    await hydrateRecommendations(movieCatalogRepository, ranking.recommendations),
    nowMs,
  ), session.preferences);
}

async function toRecommendationRounds(
  rounds: StoredRecommendationRound[],
  movieCatalogRepository: MovieCatalogRepository,
): Promise<RecommendationRound[]> {
  const movieDetails = await movieCatalogRepository.findByIds(
    rounds.flatMap((round) => [
      ...round.recommendations.map((recommendation) => recommendation.movieId),
      ...round.history.watched,
      ...round.history.liked,
      ...round.history.disliked,
    ]),
  );
  const moviesById = new Map(movieDetails.map((movie) => [movie.id, movie]));

  return rounds.map((round) => {
    return {
      createdAt: round.createdAt,
      history: round.history,
      movieTitles: resolveMovieTitles(round.history, moviesById),
      preferences: round.preferences,
      recommendations: round.recommendations.flatMap((recommendation) => {
        const movie = moviesById.get(recommendation.movieId);

        return movie
          ? [{
            ...movie,
            matchPercentage: toMatchPercentage(recommendation.score, round.preferences),
            reason: 'Recomendado nesta rodada',
            score: recommendation.score,
          }]
          : [];
      }),
    };
  });
}

async function hydrateRecommendations(
  movieCatalogRepository: MovieCatalogRepository,
  recommendations: readonly Recommendation[],
): Promise<Recommendation[]> {
  const movies = await movieCatalogRepository.findByIds(recommendations.map((recommendation) => recommendation.id));

  return hydrateRecommendationsFromMovies(recommendations, new Map(movies.map((movie) => [movie.id, movie])));
}

function hydrateRecommendationsFromMovies(
  recommendations: readonly Recommendation[],
  moviesById: ReadonlyMap<string, Movie>,
): Recommendation[] {
  return recommendations.map((recommendation) => {
    const movie = moviesById.get(recommendation.id);

    return movie
      ? { ...movie, impressionId: recommendation.impressionId, reason: recommendation.reason, score: recommendation.score }
      : recommendation;
  });
}

function withMatchPercentages(recommendations: readonly Recommendation[], preferences: Preferences): Recommendation[] {
  return recommendations.map((recommendation) => ({
    ...recommendation,
    matchPercentage: toMatchPercentage(recommendation.score, preferences),
  }));
}

function toMatchPercentage(score: number, preferences: Preferences): number {
  const maximumScore =
    preferences.genres.length * 2 +
    Number(preferences.runtime !== 'any') +
    1 +
    2;

  return Math.round(Math.min(Math.max(score / Math.max(maximumScore, 1), 0), 1) * 100);
}

function resolveMovieTitles(history: ViewerHistory, moviesById: ReadonlyMap<string, Movie>): Record<string, string> {
  const titles: Record<string, string> = {};

  for (const movieId of new Set([...history.watched, ...history.liked, ...history.disliked])) {
    const movie = moviesById.get(movieId);

    if (movie) {
      titles[movieId] = movie.title;
    }
  }

  return titles;
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
