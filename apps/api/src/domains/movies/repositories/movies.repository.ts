import type { Movie } from '../../../../../../packages/shared/src/entities/models/movie.model.js';
import { MOVIE_CATALOG_MOCK } from '../../../../../../packages/shared/src/mocks/movie/index.js';

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
