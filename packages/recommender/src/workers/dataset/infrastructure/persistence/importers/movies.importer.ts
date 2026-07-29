import type { Client } from '@libsql/client';
import { readCsv } from '../../data/csv.reader.js';
import { normalizeImdbId, normalizeMovieLensId, toMovieRecord } from '../../mappers/movie-record.mapper.js';
import { flushStatements } from '../sql-statement.writer.js';
import type { DatasetLinks, MovieFeatureDraft, MovieImportResult, SqlStatement } from '../../../domain/dataset.types.js';

export async function importMovies(client: Client, filePath: string, links: DatasetLinks): Promise<MovieImportResult> {
  const featureDrafts = new Map<string, MovieFeatureDraft>();
  const knownMovieIds = new Set<string>();
  const movieIdsByImdbId = new Map<string, string>();
  const movieIdsByMovieLensId = new Map<number, string>();
  const statements: SqlStatement[] = [];
  let importedCount = 0;

  for await (const row of readCsv(filePath)) {
    const movie = toMovieRecord(row, links);

    if (!movie) {
      continue;
    }

    importedCount += 1;
    knownMovieIds.add(movie.id);
    normalizeImdbId(movie, movieIdsByImdbId);
    normalizeMovieLensId(movie, movieIdsByMovieLensId);
    statements.push(createMovieStatement(movie));
    movie.genres.forEach((genre) => statements.push(createGenreStatement(movie.id, genre)));
    featureDrafts.set(movie.id, {
      cast: [],
      crew: [],
      genres: movie.genres.map((genre) => genre.name),
      movieId: movie.id,
      summaryText: movie.overview || movie.title,
    });

    if (statements.length >= 200) {
      await flushStatements(client, statements);
    }
  }

  await flushStatements(client, statements);
  return { featureDrafts, importedCount, knownMovieIds };
}

function createMovieStatement(movie: NonNullable<ReturnType<typeof toMovieRecord>>): SqlStatement {
  return [
    `INSERT INTO movies (id, movie_lens_id, tmdb_id, imdb_id, title, original_title, overview, tagline, homepage, original_language, status, release_date, release_year, runtime_minutes, adult, popularity, vote_average, vote_count, poster_path, backdrop_path, belongs_to_collection_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        movie_lens_id = excluded.movie_lens_id, tmdb_id = excluded.tmdb_id, imdb_id = excluded.imdb_id, title = excluded.title,
        original_title = excluded.original_title, overview = excluded.overview, tagline = excluded.tagline, homepage = excluded.homepage,
        original_language = excluded.original_language, status = excluded.status, release_date = excluded.release_date, release_year = excluded.release_year,
        runtime_minutes = excluded.runtime_minutes, adult = excluded.adult, popularity = excluded.popularity, vote_average = excluded.vote_average,
        vote_count = excluded.vote_count, poster_path = excluded.poster_path, backdrop_path = excluded.backdrop_path,
        belongs_to_collection_json = excluded.belongs_to_collection_json, updated_at = CURRENT_TIMESTAMP`,
    [movie.id, movie.movieLensId, movie.tmdbId, movie.imdbId, movie.title, movie.originalTitle, movie.overview, movie.tagline, movie.homepage, movie.originalLanguage, movie.status, movie.releaseDate, movie.releaseYear, movie.runtimeMinutes, movie.adult, movie.popularity, movie.voteAverage, movie.voteCount, movie.posterPath, movie.backdropPath, movie.belongsToCollectionJson],
  ];
}

function createGenreStatement(movieId: string, genre: { id: number; name: string; order: number }): SqlStatement {
  return [
    `INSERT INTO movie_genres (movie_id, genre_id, genre_name, genre_order, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(movie_id, genre_id) DO UPDATE SET genre_name = excluded.genre_name, genre_order = excluded.genre_order`,
    [movieId, genre.id, genre.name, genre.order],
  ];
}
