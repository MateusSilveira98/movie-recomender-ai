import type { Client } from '@libsql/client';
import type { Movie } from '@pkg/shared/entities/models/movie.model';

const MOVIE_DETAILS_BATCH_SIZE = 200;
const RANKING_CANDIDATES_BATCH_SIZE = 200;

export interface MovieCatalogRepository {
  findByIds(movieIds: readonly string[]): Promise<Movie[]>;
  listGenres(): Promise<string[]>;
  listRankingCandidates(): Promise<Movie[]>;
}

export function createSqlMovieCatalogRepository(databaseClient: Client): MovieCatalogRepository {
  return {
    async findByIds(movieIds) {
      const ids = Array.from(new Set(movieIds));

      if (ids.length === 0) {
        return [];
      }

      const batches = Array.from(
        { length: Math.ceil(ids.length / MOVIE_DETAILS_BATCH_SIZE) },
        (_value, index) => ids.slice(index * MOVIE_DETAILS_BATCH_SIZE, (index + 1) * MOVIE_DETAILS_BATCH_SIZE),
      );
      const movies = (await Promise.all(batches.map((batch) => loadMoviesByIds(databaseClient, batch)))).flat();
      const moviesById = new Map(movies.map((movie) => [movie.id, movie]));

      return ids.flatMap((id) => {
        const movie = moviesById.get(id);
        return movie ? [movie] : [];
      });
    },
    async listGenres() {
      const result = await databaseClient.execute(`
        SELECT DISTINCT movie_genres.genre_name
        FROM movie_genres
        JOIN movies ON movies.id = movie_genres.movie_id
        WHERE movies.adult = 0
          AND movies.runtime_minutes > 0
          AND COALESCE(NULLIF(TRIM(movies.title), ''), NULLIF(TRIM(movies.original_title), '')) IS NOT NULL
          AND movie_genres.genre_name <> ''
      `);

      return result.rows.map((row) => String(row.genre_name)).sort((first, second) => first.localeCompare(second));
    },
    async listRankingCandidates() {
      const movies: Movie[] = [];
      let lastMovieId = '';

      while (true) {
        const page = await loadRankingCandidatesPage(databaseClient, lastMovieId);

        if (page.length === 0) {
          return movies;
        }

        movies.push(...page);
        lastMovieId = page.at(-1)?.id ?? lastMovieId;

        if (page.length < RANKING_CANDIDATES_BATCH_SIZE) {
          return movies;
        }
      }
    },
  };
}

async function loadRankingCandidatesPage(databaseClient: Client, lastMovieId: string): Promise<Movie[]> {
  const result = await databaseClient.execute({
    args: [lastMovieId, RANKING_CANDIDATES_BATCH_SIZE],
    sql: `
        SELECT
          movies.id,
          movies.runtime_minutes,
          movies.adult,
          movies.popularity,
          movies.vote_count,
          movies.vote_average,
          movie_ratings_stats.rating_count,
          movie_ratings_stats.rating_stddev,
          COALESCE(
            json_group_array(movie_genres.genre_name) FILTER (
              WHERE movie_genres.genre_name IS NOT NULL AND movie_genres.genre_name <> ''
            ),
            '[]'
          ) AS genres_json
        FROM movies
        LEFT JOIN movie_ratings_stats ON movie_ratings_stats.movie_id = movies.id
        LEFT JOIN movie_genres ON movie_genres.movie_id = movies.id
        WHERE movies.id > ?
          AND movies.adult = 0
          AND movies.runtime_minutes > 0
          AND COALESCE(NULLIF(TRIM(movies.title), ''), NULLIF(TRIM(movies.original_title), '')) IS NOT NULL
        GROUP BY movies.id
        ORDER BY movies.id ASC
        LIMIT ?`,
  });

  return result.rows.map((row) => ({
    adult: Number(row.adult) === 1,
    description: '',
    genres: parseGenres(row.genres_json),
    id: String(row.id),
    modelFeatures: toModelFeatures(row),
    popularity: Number(row.popularity),
    runtime: Number(row.runtime_minutes),
    title: '',
    voteCount: Number(row.vote_count),
    year: 0,
  }));
}

async function loadMoviesByIds(databaseClient: Client, movieIds: readonly string[]): Promise<Movie[]> {
  const placeholders = movieIds.map(() => '?').join(', ');
  const result = await databaseClient.execute({
    args: [...movieIds],
    sql: `SELECT
      movies.id,
      COALESCE(NULLIF(TRIM(movies.title), ''), NULLIF(TRIM(movies.original_title), '')) AS title,
      movies.release_year,
      movies.runtime_minutes,
      movies.adult,
      movies.popularity,
      movies.vote_count,
      movies.overview,
      movie_genres.genre_name
    FROM movies
    LEFT JOIN movie_genres ON movie_genres.movie_id = movies.id
    WHERE movies.id IN (${placeholders})
      AND COALESCE(NULLIF(TRIM(movies.title), ''), NULLIF(TRIM(movies.original_title), '')) IS NOT NULL
    ORDER BY movies.id ASC, movie_genres.genre_order ASC`,
  });

  return groupMovies(result.rows);
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

function parseGenres(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((genre): genre is string => typeof genre === 'string') : [];
  } catch {
    return [];
  }
}

function toModelFeatures(row: Record<string, unknown>): Movie['modelFeatures'] {
  const ratingCount = Number(row.rating_count);
  const ratingStddev = Number(row.rating_stddev);
  const voteAverage = Number(row.vote_average);

  if (
    !Number.isFinite(ratingCount) || ratingCount <= 0 ||
    !Number.isFinite(ratingStddev) || ratingStddev < 0 ||
    !Number.isFinite(voteAverage) || voteAverage < 0 || voteAverage > 10
  ) {
    return undefined;
  }

  return { ratingCount, ratingStddev, voteAverage };
}
