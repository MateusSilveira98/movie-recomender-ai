import type { Client } from '@libsql/client';
import type { Movie } from '@pkg/shared/entities/models/movie.model';

export interface MovieCatalogRepository {
  list(): Promise<Movie[]>;
}

export function createSqlMovieCatalogRepository(databaseClient: Client): MovieCatalogRepository {
  return {
    async list() {
      const result = await databaseClient.execute(`
        SELECT
          movies.id,
          movies.title,
          movies.release_year,
          movies.runtime_minutes,
          movies.adult,
          movies.popularity,
          movies.vote_count,
          movies.overview,
          movie_genres.genre_name
        FROM movies
        LEFT JOIN movie_genres ON movie_genres.movie_id = movies.id
        WHERE movies.adult = 0
        ORDER BY movies.id ASC, movie_genres.genre_order ASC
      `);

      return groupMovies(result.rows);
    },
  };
}

function groupMovies(rows: Array<Record<string, unknown>>): Movie[] {
  const moviesById = new Map<string, Movie>();

  for (const row of rows) {
    const id = String(row.id);
    const existing = moviesById.get(id);
    const movie = existing ?? {
      adult: Number(row.adult) === 1,
      description: String(row.overview ?? ''),
      genres: [],
      id,
      popularity: Number(row.popularity),
      runtime: Number(row.runtime_minutes),
      title: String(row.title),
      voteCount: Number(row.vote_count),
      year: Number(row.release_year),
    };

    if (!existing) {
      moviesById.set(id, movie);
    }

    if (typeof row.genre_name === 'string' && row.genre_name.length > 0) {
      movie.genres.push(row.genre_name);
    }
  }

  return Array.from(moviesById.values());
}
