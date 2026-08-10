import { RUNTIME_PREFERENCE_LABELS } from '@pkg/shared/entities/consts/runtime-preference-labels.const';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { SessionProfile } from '@pkg/shared/entities/models/session-profile.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { RuntimePreference } from '@pkg/shared/entities/types/runtime-preference.type';
import { MOVIE_CATALOG_MOCK } from '@pkg/shared/mocks/movie';

export { createDatasetImportQueue, type DatasetImportQueue } from './workers/dataset/application/dataset-import-queue.service.js';
export {
  DATASET_FILE_TYPES,
  type DatasetDiagnosticSummary,
  type DatasetDiagnosticsPage,
  type DatasetDiagnosticsPagination,
  type DatasetFileType,
  type DatasetImportDiagnostic,
  type DatasetImportJob,
  type DatasetUpload,
} from './workers/dataset/domain/dataset-import-queue.types.js';

export const RANKING_VERSION = 'hybrid-v1';

const MODEL_SCORE_REASON_THRESHOLD = 0.5;
const RECOMMENDATION_LIMIT = 4;
const RANKING_WEIGHTS = {
  dislikedGenreMatch: -1,
  likedGenreMatch: 1,
  modelScore: 2,
  preferenceGenreMatch: 2,
  runtimeMatch: 1,
  runtimeMismatch: -1,
} as const;

export interface ModelScoreBatch {
  modelVersion?: string;
  scores: ReadonlyMap<string, number>;
}

export interface ModelScoreProvider {
  getScores(movies: readonly Movie[]): ModelScoreBatch;
}

export interface RecommendationRanker {
  rank(catalog: readonly Movie[], preferences: Preferences, history: ViewerHistory): RecommendationRanking;
}

export interface RecommendationRankerOptions {
  modelScoreProvider?: ModelScoreProvider;
}

export interface RecommendationRanking {
  candidateCount: number;
  modelVersion?: string;
  rankingVersion: typeof RANKING_VERSION;
  recommendations: Recommendation[];
}

export function createRecommendationRanker(options: RecommendationRankerOptions = {}): RecommendationRanker {
  return {
    rank(catalog, preferences, history) {
      return rankRecommendations(catalog, preferences, history, options);
    },
  };
}

export function rankRecommendations(
  catalog: readonly Movie[],
  preferences: Preferences,
  history: ViewerHistory,
  options: RecommendationRankerOptions = {},
): RecommendationRanking {
  const candidates = getEligibleMovies(catalog, history);
  const moviesById = new Map(catalog.map((movie) => [movie.id, movie]));
  const modelScoreBatch = resolveModelScores(candidates, options.modelScoreProvider);

  return {
    candidateCount: candidates.length,
    modelVersion: modelScoreBatch.modelVersion,
    rankingVersion: RANKING_VERSION,
    recommendations: candidates
      .map((movie) => buildRecommendation(movie, preferences, history, moviesById, modelScoreBatch.scores.get(movie.id)))
      .sort(compareRecommendations)
      .slice(0, RECOMMENDATION_LIMIT),
  };
}

export function getRecommendations(catalog: readonly Movie[], preferences: Preferences, history: ViewerHistory): Recommendation[] {
  return rankRecommendations(catalog, preferences, history).recommendations;
}

export function getDemoRecommendations(profile: SessionProfile): Recommendation[] {
  return getRecommendations(
    MOVIE_CATALOG_MOCK,
    {
      freeText: '',
      genres: profile.genres,
      runtime: 'medium',
    },
    {
      watched: [],
      liked: resolveMovieIdsByTitle(profile.likedMovies),
      disliked: resolveMovieIdsByTitle(profile.dislikedMovies),
    },
  );
}

function getEligibleMovies(catalog: readonly Movie[], history: ViewerHistory): Movie[] {
  const excludedMovieIds = new Set([...history.watched, ...history.liked, ...history.disliked]);

  return catalog.filter((movie) => !movie.adult && !excludedMovieIds.has(movie.id));
}

function buildRecommendation(
  movie: Movie,
  preferences: Preferences,
  history: ViewerHistory,
  moviesById: ReadonlyMap<string, Movie>,
  modelScore: number | undefined,
): Recommendation {
  const genreMatches = movie.genres.filter((genre) => preferences.genres.includes(genre));
  const likedGenreScore = getHistoryGenreScore(movie, history.liked, moviesById);
  const dislikedGenreScore = getHistoryGenreScore(movie, history.disliked, moviesById);
  const runtimeScore = getRuntimeScore(movie, preferences);
  const runtimeMatches = preferences.runtime !== 'any' && matchesRuntimePreference(movie.runtime, preferences.runtime);
  const score =
    genreMatches.length * RANKING_WEIGHTS.preferenceGenreMatch +
    runtimeScore +
    likedGenreScore * RANKING_WEIGHTS.likedGenreMatch +
    dislikedGenreScore * RANKING_WEIGHTS.dislikedGenreMatch +
    (modelScore ?? 0) * RANKING_WEIGHTS.modelScore;

  return {
    ...movie,
    reason: buildReason(genreMatches, preferences, likedGenreScore, modelScore, runtimeMatches),
    score,
  };
}

function getRuntimeScore(movie: Movie, preferences: Preferences): number {
  if (preferences.runtime === 'any') {
    return 0;
  }

  return matchesRuntimePreference(movie.runtime, preferences.runtime)
    ? RANKING_WEIGHTS.runtimeMatch
    : RANKING_WEIGHTS.runtimeMismatch;
}

function getHistoryGenreScore(movie: Movie, movieIds: readonly string[], moviesById: ReadonlyMap<string, Movie>): number {
  const referenceMovies = movieIds.map((movieId) => moviesById.get(movieId)).filter((reference): reference is Movie => reference !== undefined);

  if (referenceMovies.length === 0) {
    return 0;
  }

  return referenceMovies.reduce(
    (score, referenceMovie) => score + Number(referenceMovie.genres.some((genre) => movie.genres.includes(genre))),
    0,
  ) / referenceMovies.length;
}

function compareRecommendations(first: Recommendation, second: Recommendation): number {
  const scoreDifference = second.score - first.score;

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  const popularityDifference = second.popularity - first.popularity;

  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  const voteCountDifference = second.voteCount - first.voteCount;

  if (voteCountDifference !== 0) {
    return voteCountDifference;
  }

  if (first.id === second.id) {
    return 0;
  }

  return first.id < second.id ? -1 : 1;
}

function buildReason(
  genreMatches: readonly string[],
  preferences: Preferences,
  likedGenreScore: number,
  modelScore: number | undefined,
  runtimeMatches: boolean,
): string {
  const reasons = [];

  if (genreMatches.length > 0) {
    reasons.push(`combina com ${genreMatches.join(' e ')}`);
  }

  if (preferences.runtime !== 'any' && runtimeMatches) {
    reasons.push(`tem duracao ${RUNTIME_PREFERENCE_LABELS[preferences.runtime].toLowerCase()}`);
  }

  if (likedGenreScore > 0) {
    reasons.push('tem generos parecidos com filmes que vc curtiu');
  }

  if (modelScore !== undefined && modelScore >= MODEL_SCORE_REASON_THRESHOLD) {
    reasons.push('tem boa avaliacao estimada pelo modelo');
  }

  return reasons.length > 0 ? reasons.join(', ') : 'amplia suas opcoes sem repetir o historico';
}

function resolveModelScores(candidates: readonly Movie[], provider: ModelScoreProvider | undefined): ResolvedModelScores {
  if (!provider || candidates.length === 0) {
    return emptyModelScores();
  }

  try {
    const batch: unknown = provider.getScores(candidates);

    if (!isModelScoreBatch(batch)) {
      return emptyModelScores();
    }

    const scores = new Map<string, number>();

    for (const movie of candidates) {
      const score = batch.scores.get(movie.id);

      if (score === undefined) {
        continue;
      }

      if (!Number.isFinite(score) || score < 0 || score > 1) {
        return emptyModelScores();
      }

      scores.set(movie.id, score);
    }

    return scores.size > 0 ? { modelVersion: normalizeModelVersion(batch.modelVersion), scores } : emptyModelScores();
  } catch {
    return emptyModelScores();
  }
}

function isModelScoreBatch(value: unknown): value is ModelScoreBatch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const scores = (value as { scores?: unknown }).scores;

  return typeof scores === 'object' && scores !== null && 'get' in scores && typeof (scores as { get?: unknown }).get === 'function';
}

function emptyModelScores(): ResolvedModelScores {
  return { scores: new Map() };
}

function normalizeModelVersion(modelVersion: string | undefined): string | undefined {
  const normalized = modelVersion?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveMovieIdsByTitle(movieTitles: string[]): string[] {
  return MOVIE_CATALOG_MOCK.filter((movie) => movieTitles.includes(movie.title)).map((movie) => movie.id);
}

function matchesRuntimePreference(runtime: number, preference: RuntimePreference): boolean {
  if (preference === 'short') {
    return runtime <= 90;
  }

  if (preference === 'medium') {
    return runtime > 90 && runtime <= 120;
  }

  return runtime > 120;
}

interface ResolvedModelScores {
  modelVersion?: string;
  scores: ReadonlyMap<string, number>;
}
