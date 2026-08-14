import type { Client } from '@libsql/client';
import { readCsvRecords } from '../../data/csv.reader.js';
import { toMovieRecord } from '../../mappers/movie-record.mapper.js';
import { createDatasetDiagnostic, validateDatasetRecord } from '../../validation/dataset-csv.validator.js';
import type { DatasetImportDiagnosticsCollector } from '../dataset-import-diagnostics.repository.js';
import { flushStatements } from '../sql-statement.writer.js';
import type { DatasetLinks, MovieFeatureDraft, MovieImportResult, SqlStatement } from '../../../domain/dataset.types.js';

export async function importMovies(client: Client, filePath: string, links: DatasetLinks, diagnostics: DatasetImportDiagnosticsCollector): Promise<MovieImportResult> {
  const featureDrafts = new Map<string, MovieFeatureDraft>();
  const knownMovieIds = new Set<string>();
  const identities = await loadMovieIdentities(client);
  const seenMovieIds = new Set<string>();
  const statements: SqlStatement[] = [];
  let importedCount = 0;
  let processedCount = 0;
  let rejectedCount = 0;

  for await (const record of readCsvRecords(filePath)) {
    processedCount += 1;
    const validationIssues = validateDatasetRecord('movies', record);

    if (validationIssues.length > 0) {
      await recordDiagnostics(diagnostics, validationIssues);
      rejectedCount += 1;
      continue;
    }

    const movie = toMovieRecord(record.row, links);

    if (!movie) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'validation',
        field: 'id',
        message: 'Nao foi possivel normalizar o registro de filme.',
        reason: 'invalid_field',
        ruleCode: 'movie_normalization',
        value: record.row.id ?? null,
      }));
      rejectedCount += 1;
      continue;
    }

    const conflict = findIdentityConflict(movie, identities, seenMovieIds);

    if (conflict) {
      await diagnostics.record(createDatasetDiagnostic(record, conflict));
      rejectedCount += 1;
      continue;
    }

    reserveMovieIdentities(movie, identities, seenMovieIds);
    importedCount += 1;
    knownMovieIds.add(movie.id);
    statements.push(['DELETE FROM movie_genres WHERE movie_id = ?', [movie.id]]);
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
  return { featureDrafts, importedCount, knownMovieIds, processedCount, rejectedCount };
}

interface MovieIdentities {
  byImdbId: Map<string, string>;
  byMovieLensId: Map<number, string>;
}

function findIdentityConflict(
  movie: NonNullable<ReturnType<typeof toMovieRecord>>,
  identities: MovieIdentities,
  seenMovieIds: Set<string>,
): Omit<Parameters<DatasetImportDiagnosticsCollector['record']>[0], 'lineEnd' | 'lineStart'> | null {
  if (seenMovieIds.has(movie.id)) {
    return duplicateDiagnostic('id', movie.id, 'duplicate_movie_id', 'O id do filme aparece mais de uma vez no arquivo.');
  }

  if (movie.imdbId && hasIdentityConflict(identities.byImdbId, movie.imdbId, movie.id)) {
    return duplicateDiagnostic('imdb_id', movie.imdbId, 'conflicting_imdb_id', 'O imdb_id ja esta associado a outro filme.');
  }

  if (movie.movieLensId !== null && hasIdentityConflict(identities.byMovieLensId, movie.movieLensId, movie.id)) {
    return duplicateDiagnostic('movieId', String(movie.movieLensId), 'conflicting_movielens_id', 'O vinculo MovieLens ja esta associado a outro filme.');
  }

  return null;
}

function duplicateDiagnostic(field: string, value: string, ruleCode: string, message: string) {
  return { category: 'integrity' as const, field, message, reason: 'duplicate_value' as const, ruleCode, value };
}

function hasIdentityConflict<T extends string | number>(identities: Map<T, string>, value: T, movieId: string): boolean {
  const existingMovieId = identities.get(value);

  return Boolean(existingMovieId && existingMovieId !== movieId);
}

function reserveMovieIdentities(movie: NonNullable<ReturnType<typeof toMovieRecord>>, identities: MovieIdentities, seenMovieIds: Set<string>): void {
  seenMovieIds.add(movie.id);

  if (movie.imdbId) {
    identities.byImdbId.set(movie.imdbId, movie.id);
  }

  if (movie.movieLensId !== null) {
    identities.byMovieLensId.set(movie.movieLensId, movie.id);
  }
}

async function loadMovieIdentities(client: Client): Promise<MovieIdentities> {
  const result = await client.execute('SELECT id, imdb_id, movie_lens_id FROM movies');
  const byImdbId = new Map<string, string>();
  const byMovieLensId = new Map<number, string>();

  for (const row of result.rows) {
    const movieId = String(row.id);

    if (row.imdb_id) {
      byImdbId.set(String(row.imdb_id), movieId);
    }

    if (typeof row.movie_lens_id === 'number' && Number.isSafeInteger(row.movie_lens_id)) {
      byMovieLensId.set(row.movie_lens_id, movieId);
    }
  }

  return { byImdbId, byMovieLensId };
}

async function recordDiagnostics(diagnostics: DatasetImportDiagnosticsCollector, issues: Parameters<DatasetImportDiagnosticsCollector['record']>[0][]): Promise<void> {
  for (const issue of issues) {
    await diagnostics.record(issue);
  }
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
