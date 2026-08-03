import { RUNTIME_PREFERENCE_LABELS } from '@pkg/shared/entities/consts/runtime-preference-labels.const';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { SessionProfile } from '@pkg/shared/entities/models/session-profile.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { RuntimePreference } from '@pkg/shared/entities/types/runtime-preference.type';
import { MOVIE_CATALOG_MOCK } from '@pkg/shared/mocks/movie';

export { createDatasetImportQueue, type DatasetImportQueue } from './workers/dataset/application/dataset-import-queue.service.js';
export { DATASET_FILE_TYPES, type DatasetFileType, type DatasetImportJob, type DatasetUpload } from './workers/dataset/domain/dataset-import-queue.types.js';

export function getRecommendations(catalog: Movie[], preferences: Preferences, history: ViewerHistory): Recommendation[] {
  const watchedMovieIds = new Set(history.watched);
  const moviesById = new Map(catalog.map((movie) => [movie.id, movie]));

  return catalog
    .filter((movie) => !movie.adult && !watchedMovieIds.has(movie.id))
    .map((movie) => buildRecommendation(movie, preferences, history, moviesById))
    .sort(compareRecommendations)
    .slice(0, 4);
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

function buildRecommendation(
  movie: Movie,
  preferences: Preferences,
  history: ViewerHistory,
  moviesById: Map<string, Movie>,
): Recommendation {
  const genreMatches = movie.genres.filter((genre) => preferences.genres.includes(genre));
  const score =
    genreMatches.length * 2 +
    getRuntimeScore(movie, preferences) +
    getHistoryGenreScore(movie, history.liked, moviesById) -
    getHistoryGenreScore(movie, history.disliked, moviesById);

  return {
    ...movie,
    score,
    reason: buildReason(movie, genreMatches, preferences, history),
  };
}

function getRuntimeScore(movie: Movie, preferences: Preferences): number {
  if (preferences.runtime === 'any') {
    return 0;
  }

  return matchesRuntimePreference(movie.runtime, preferences.runtime) ? 1 : -1;
}

function getHistoryGenreScore(movie: Movie, movieIds: string[], moviesById: Map<string, Movie>): number {
  return movieIds.reduce((score, movieId) => {
    const watchedMovie = moviesById.get(movieId);
    const hasGenreMatch = watchedMovie?.genres.some((genre) => movie.genres.includes(genre));

    return score + (hasGenreMatch ? 1 : 0);
  }, 0);
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

function buildReason(movie: Movie, genreMatches: string[], preferences: Preferences, history: ViewerHistory): string {
  const reasons = [];

  if (genreMatches.length > 0) {
    reasons.push(`combina com ${genreMatches.join(' e ')}`);
  }

  if (preferences.runtime !== 'any' && matchesRuntimePreference(movie.runtime, preferences.runtime)) {
    reasons.push(`tem duracao ${RUNTIME_PREFERENCE_LABELS[preferences.runtime].toLowerCase()}`);
  }

  if (history.liked.length > 0) {
    reasons.push('usa como referencia os filmes que vc curtiu');
  }

  return reasons.length > 0 ? reasons.join(', ') : 'amplia suas opcoes sem repetir o historico';
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
