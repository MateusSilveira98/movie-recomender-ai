import type { Movie } from '@pkg/shared/entities/models/movie.model';
import { MOVIE_CATALOG_MOCK } from '@pkg/shared/mocks/movie';

export interface MovieCatalogRepository {
  list(): Movie[];
}

export function createInMemoryMovieCatalogRepository(): MovieCatalogRepository {
  return {
    list() {
      return MOVIE_CATALOG_MOCK;
    },
  };
}
