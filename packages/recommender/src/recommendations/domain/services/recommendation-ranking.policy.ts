import { RUNTIME_PREFERENCE_LABELS } from '@pkg/shared/entities/consts/runtime-preference-labels.const';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { RuntimePreference } from '@pkg/shared/entities/types/runtime-preference.type';
import type { RecommendationRankingPolicy } from '../models/recommendation-ranking-policy.model.js';

export function getEligibleMovies(catalog: readonly Movie[], history: ViewerHistory): Movie[] {
  const excludedMovieIds = new Set([...history.watched, ...history.liked, ...history.disliked]);

  return catalog.filter((movie) => !movie.adult && !excludedMovieIds.has(movie.id));
}

export function buildRankedRecommendations(
  candidates: readonly Movie[],
  catalog: readonly Movie[],
  preferences: Preferences,
  history: ViewerHistory,
  modelScores: ReadonlyMap<string, number>,
  policy: RecommendationRankingPolicy,
): Recommendation[] {
  const moviesById = new Map(catalog.map((movie) => [movie.id, movie]));

  return candidates
    .map((movie) => buildRecommendation(movie, preferences, history, moviesById, modelScores.get(movie.id), policy))
    .sort(compareRecommendations)
    .slice(0, policy.recommendationLimit);
}

function buildRecommendation(
  movie: Movie,
  preferences: Preferences,
  history: ViewerHistory,
  moviesById: ReadonlyMap<string, Movie>,
  modelScore: number | undefined,
  policy: RecommendationRankingPolicy,
): Recommendation {
  const genreMatches = movie.genres.filter((genre) => preferences.genres.includes(genre));
  const likedGenreScore = getHistoryGenreScore(movie, history.liked, moviesById);
  const dislikedGenreScore = getHistoryGenreScore(movie, history.disliked, moviesById);
  const runtimeScore = getRuntimeScore(movie, preferences, policy);
  const runtimeMatches = preferences.runtime !== 'any' && matchesRuntimePreference(movie.runtime, preferences.runtime);
  const score =
    genreMatches.length * policy.weights.preferenceGenreMatch +
    runtimeScore +
    likedGenreScore * policy.weights.likedGenreMatch +
    dislikedGenreScore * policy.weights.dislikedGenreMatch +
    (modelScore ?? 0) * policy.weights.modelScore;

  return {
    ...movie,
    reason: buildReason(genreMatches, preferences, likedGenreScore, modelScore, runtimeMatches, policy),
    score,
  };
}

function getRuntimeScore(movie: Movie, preferences: Preferences, policy: RecommendationRankingPolicy): number {
  if (preferences.runtime === 'any') {
    return 0;
  }

  return matchesRuntimePreference(movie.runtime, preferences.runtime)
    ? policy.weights.runtimeMatch
    : policy.weights.runtimeMismatch;
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
  policy: RecommendationRankingPolicy,
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

  if (modelScore !== undefined && modelScore >= policy.modelScoreReasonThreshold) {
    reasons.push('tem boa avaliacao estimada pelo modelo');
  }

  return reasons.length > 0 ? reasons.join(', ') : 'amplia suas opcoes sem repetir o historico';
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
