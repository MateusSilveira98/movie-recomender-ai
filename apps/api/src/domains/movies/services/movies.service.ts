import type { Movie } from '../../../../../../packages/shared/src/entities/models/movie.model.js';
import type { RuntimePreference } from '../../../../../../packages/shared/src/entities/types/runtime-preference.type.js';
import type { MovieFilter } from '../entities/movie-filter.entity.js';
import type { MovieCatalogRepository } from '../repositories/movies.repository.js';

export interface MoviesService {
  listByFilter(filter: MovieFilter): Movie[];
  listGenres(): string[];
}

export function createMoviesService(movieCatalogRepository: MovieCatalogRepository): MoviesService {
  return {
    listByFilter(filter) {
      const candidates = movieCatalogRepository.list().filter(
        (movie) =>
          !movie.adult &&
          matchesGenres(movie, filter.genres) &&
          matchesRuntimePreference(movie.runtime, filter.runtime),
      );

      return sortByCandidateScore(candidates).slice(0, filter.limit);
    },
    listGenres() {
      return Array.from(new Set(movieCatalogRepository.list().flatMap((movie) => movie.genres))).sort((first, second) =>
        first.localeCompare(second),
      );
    },
  };
}

function matchesGenres(movie: Movie, genres: string[]): boolean {
  return genres.length === 0 || movie.genres.some((genre) => genres.includes(genre));
}

function matchesRuntimePreference(runtime: number, preference: RuntimePreference): boolean {
  if (preference === 'any') {
    return true;
  }

  if (preference === 'short') {
    return runtime <= 90;
  }

  if (preference === 'medium') {
    return runtime > 90 && runtime <= 120;
  }

  return runtime > 120;
}

function sortByCandidateScore(movies: Movie[]): Movie[] {
  const maxPopularity = Math.max(...movies.map((movie) => movie.popularity), 1);
  const maxVoteCount = Math.max(...movies.map((movie) => Math.log1p(movie.voteCount)), 1);

  return [...movies].sort(
    (first, second) =>
      getCandidateScore(second, maxPopularity, maxVoteCount) -
      getCandidateScore(first, maxPopularity, maxVoteCount),
  );
}

function getCandidateScore(movie: Movie, maxPopularity: number, maxVoteCount: number): number {
  const normalizedPopularity = movie.popularity / maxPopularity;
  const normalizedVoteCount = Math.log1p(movie.voteCount) / maxVoteCount;

  return normalizedPopularity * 0.65 + normalizedVoteCount * 0.35;
}
