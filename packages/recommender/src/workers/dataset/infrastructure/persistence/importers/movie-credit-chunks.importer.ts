import type { Client } from '@libsql/client';
import { parseLooseArray, type CsvRecord } from '../../data/csv.reader.js';
import { parseMovieId, toCastRecord, toCrewRecord, toMovieRecord, type MovieRecord } from '../../mappers/movie-record.mapper.js';
import { createDatasetDiagnostic, validateDatasetRecord } from '../../validation/dataset-csv.validator.js';
import type { DatasetLinks } from '../../../domain/dataset.types.js';
import type { DatasetImportDiagnosticsCollector } from '../dataset-import-diagnostics.repository.js';
import { flushStatements } from '../sql-statement.writer.js';
import type { SqlStatement } from '../../../domain/dataset.types.js';
import {
  reserveCreditKey,
  reserveMovieKeys,
  type StagedCreditRecord,
  type StagedMovieRecord,
} from '../dataset-import-movie-credit-chunk-records.repository.js';

export interface ChunkCollectionResult<T> {
  records: T[];
  result: { importedRows: number; missingDependencyRows: number; processedRows: number; rejectedRows: number };
}

const movieReservationBatchSize = 25;

export async function collectMovieChunkRecords(client: Client, records: AsyncIterable<CsvRecord> | Iterable<CsvRecord>, links: DatasetLinks, uploadId: string, chunkId: string, diagnostics: DatasetImportDiagnosticsCollector, seenMovieIds = new Set<string>()): Promise<ChunkCollectionResult<StagedMovieRecord>> {
  const staged: StagedMovieRecord[] = [];
  let importedRows = 0;
  let processedRows = 0;
  let rejectedRows = 0;
  const candidates: { movie: MovieRecord; record: CsvRecord }[] = [];
  for await (const record of records) {
    processedRows += 1;
    const issues = validateDatasetRecord('movies', record);
    if (issues.length > 0) { await recordDiagnostics(diagnostics, issues); rejectedRows += 1; continue; }
    const movie = toMovieRecord(record.row, links);
    if (!movie) { await diagnostics.record(invalidDiagnostic(record, 'id', 'movie_normalization', 'Não foi possível normalizar o registro de filme.')); rejectedRows += 1; continue; }
    if (seenMovieIds.has(movie.id)) {
      await diagnostics.record(invalidDiagnostic(record, 'id', 'duplicate_movie_id', 'O id do filme aparece mais de uma vez no chunk.', 'integrity', 'duplicate_value'));
      rejectedRows += 1;
      continue;
    }
    seenMovieIds.add(movie.id);
    candidates.push({ movie, record });
    if (candidates.length === movieReservationBatchSize) {
      const result = await reserveMovieBatch(client, uploadId, chunkId, candidates, diagnostics);
      staged.push(...result.records);
      importedRows += result.importedRows;
      rejectedRows += result.rejectedRows;
      candidates.length = 0;
    }
  }
  const result = await reserveMovieBatch(client, uploadId, chunkId, candidates, diagnostics);
  staged.push(...result.records);
  importedRows += result.importedRows;
  rejectedRows += result.rejectedRows;
  return { records: staged, result: { importedRows, missingDependencyRows: 0, processedRows, rejectedRows } };
}

async function reserveMovieBatch(client: Client, uploadId: string, chunkId: string, candidates: readonly { movie: MovieRecord; record: CsvRecord }[], diagnostics: DatasetImportDiagnosticsCollector): Promise<{ importedRows: number; records: StagedMovieRecord[]; rejectedRows: number }> {
  const accepted = await reserveMovieKeys(client, uploadId, chunkId, candidates.map((candidate) => candidate.movie));
  const records: StagedMovieRecord[] = [];
  let rejectedRows = 0;

  for (const [index, candidate] of candidates.entries()) {
    if (!accepted[index]) {
      await diagnostics.record(invalidDiagnostic(candidate.record, 'id', 'duplicate_or_conflicting_movie', 'O filme ou uma de suas identidades já foi informado por outro chunk.', 'integrity', 'duplicate_value'));
      rejectedRows += 1;
      continue;
    }
    records.push({ lineEnd: candidate.record.lineEnd, lineStart: candidate.record.lineStart, movie: candidate.movie });
  }

  return { importedRows: records.length, records, rejectedRows };
}

export async function collectCreditChunkRecords(client: Client, records: AsyncIterable<CsvRecord> | Iterable<CsvRecord>, uploadId: string, chunkId: string, diagnostics: DatasetImportDiagnosticsCollector, seenMovieIds = new Set<string>()): Promise<ChunkCollectionResult<StagedCreditRecord>> {
  const staged: StagedCreditRecord[] = [];
  let importedRows = 0;
  let processedRows = 0;
  let rejectedRows = 0;
  for await (const record of records) {
    processedRows += 1;
    const issues = validateDatasetRecord('credits', record);
    if (issues.length > 0) { await recordDiagnostics(diagnostics, issues); rejectedRows += 1; continue; }
    const movieId = parseMovieId(record.row.id);
    if (!movieId) { await diagnostics.record(invalidDiagnostic(record, 'id', 'movie_id_normalization', 'Não foi possível normalizar o identificador do filme.')); rejectedRows += 1; continue; }
    if (seenMovieIds.has(movieId)) {
      await diagnostics.record(invalidDiagnostic(record, 'id', 'duplicate_movie_credits', 'O filme possui mais de uma linha de créditos no chunk.', 'integrity', 'duplicate_value'));
      rejectedRows += 1;
      continue;
    }
    if (!await reserveCreditKey(client, uploadId, chunkId, movieId)) {
      await diagnostics.record(invalidDiagnostic(record, 'id', 'duplicate_movie_credits', 'O filme possui mais de uma linha de créditos no upload.', 'integrity', 'duplicate_value'));
      rejectedRows += 1;
      continue;
    }
    const cast = parseLooseArray(record.row.cast).map((member, index) => toCastRecord(member, movieId, index));
    const crew = parseLooseArray(record.row.crew).map((member) => toCrewRecord(member, movieId));
    if (cast.some((member) => member === null) || crew.some((member) => member === null)) {
      await diagnostics.record(invalidDiagnostic(record, 'cast', 'credit_normalization', 'Não foi possível normalizar todos os créditos do filme.'));
      rejectedRows += 1;
      continue;
    }
    staged.push({ cast: cast.filter((member): member is NonNullable<typeof member> => member !== null), crew: crew.filter((member): member is NonNullable<typeof member> => member !== null), lineEnd: record.lineEnd, lineStart: record.lineStart, movieId });
    seenMovieIds.add(movieId);
    importedRows += 1;
  }
  return { records: staged, result: { importedRows, missingDependencyRows: 0, processedRows, rejectedRows } };
}

export async function promoteMovies(client: Client, records: readonly StagedMovieRecord[]): Promise<void> {
  const statements: SqlStatement[] = [];

  for (const { movie } of records) {
    statements.push(
      [movieUpsertSql, movieArgs(movie)],
      ['DELETE FROM movie_genres WHERE movie_id = ?', [movie.id]],
      ...movie.genres.map((genre) => [`INSERT INTO movie_genres (movie_id, genre_id, genre_name, genre_order, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(movie_id, genre_id) DO UPDATE SET genre_name = excluded.genre_name, genre_order = excluded.genre_order`, [movie.id, genre.id, genre.name, genre.order]] as SqlStatement),
      [`INSERT INTO movie_features (movie_id, summary_text, genres_json, cast_json, crew_json, feature_vector_json, feature_version, created_at, updated_at) VALUES (?, ?, ?, '[]', '[]', '[]', 'v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(movie_id) DO UPDATE SET summary_text = excluded.summary_text, genres_json = excluded.genres_json, updated_at = CURRENT_TIMESTAMP`, [movie.id, movie.overview || movie.title, JSON.stringify(movie.genres.map((genre) => genre.name))]],
    );
  }

  await flushStatements(client, statements, 100);
}

export async function promoteCredits(client: Client, records: readonly StagedCreditRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  const existingMovies = await client.execute({
    sql: `SELECT id FROM movies WHERE id IN (${records.map(() => '?').join(', ')})`,
    args: records.map((record) => record.movieId),
  });
  const existingMovieIds = new Set(existingMovies.rows.map((row) => String(row.id)));
  const statements: SqlStatement[] = [];
  let missingDependencyRows = 0;

  for (const record of records) {
    if (!existingMovieIds.has(record.movieId)) { missingDependencyRows += 1; continue; }
    statements.push(
      ['DELETE FROM movie_cast WHERE movie_id = ?', [record.movieId]],
      ['DELETE FROM movie_crew WHERE movie_id = ?', [record.movieId]],
      ...record.cast.map((member) => [`INSERT INTO movie_cast (movie_id, credit_id, cast_order, person_id, person_name, character_name, gender, profile_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(movie_id, credit_id) DO UPDATE SET cast_order = excluded.cast_order, person_id = excluded.person_id, person_name = excluded.person_name, character_name = excluded.character_name, gender = excluded.gender, profile_path = excluded.profile_path`, [member.movieId, member.creditId, member.castOrder, member.personId, member.personName, member.characterName, member.gender, member.profilePath]] as SqlStatement),
      ...record.crew.map((member) => [`INSERT INTO movie_crew (movie_id, credit_id, person_id, person_name, department, job, gender, profile_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(movie_id, credit_id) DO UPDATE SET person_id = excluded.person_id, person_name = excluded.person_name, department = excluded.department, job = excluded.job, gender = excluded.gender, profile_path = excluded.profile_path`, [member.movieId, member.creditId, member.personId, member.personName, member.department, member.job, member.gender, member.profilePath]] as SqlStatement),
      [`UPDATE movie_features SET cast_json = ?, crew_json = ?, updated_at = CURRENT_TIMESTAMP WHERE movie_id = ?`, [JSON.stringify(unique(record.cast.map((member) => member.personName))), JSON.stringify(unique(record.crew.filter((member) => indexedCrewJobs.has(member.job)).map((member) => `${member.job}: ${member.personName}`))), record.movieId]],
    );
  }

  await flushStatements(client, statements, 100);
  return missingDependencyRows;
}

const indexedCrewJobs = new Set(['Director', 'Screenplay', 'Producer', 'Original Story', 'Original Music Composer']);
const movieUpsertSql = `INSERT INTO movies (id, movie_lens_id, tmdb_id, imdb_id, title, original_title, overview, tagline, homepage, original_language, status, release_date, release_year, runtime_minutes, adult, popularity, vote_average, vote_count, poster_path, backdrop_path, belongs_to_collection_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET movie_lens_id = excluded.movie_lens_id, tmdb_id = excluded.tmdb_id, imdb_id = excluded.imdb_id, title = excluded.title, original_title = excluded.original_title, overview = excluded.overview, tagline = excluded.tagline, homepage = excluded.homepage, original_language = excluded.original_language, status = excluded.status, release_date = excluded.release_date, release_year = excluded.release_year, runtime_minutes = excluded.runtime_minutes, adult = excluded.adult, popularity = excluded.popularity, vote_average = excluded.vote_average, vote_count = excluded.vote_count, poster_path = excluded.poster_path, backdrop_path = excluded.backdrop_path, belongs_to_collection_json = excluded.belongs_to_collection_json, updated_at = CURRENT_TIMESTAMP`;
function movieArgs(movie: MovieRecord) { return [movie.id, movie.movieLensId, movie.tmdbId, movie.imdbId, movie.title, movie.originalTitle, movie.overview, movie.tagline, movie.homepage, movie.originalLanguage, movie.status, movie.releaseDate, movie.releaseYear, movie.runtimeMinutes, movie.adult, movie.popularity, movie.voteAverage, movie.voteCount, movie.posterPath, movie.backdropPath, movie.belongsToCollectionJson].map((value) => value ?? null); }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))].slice(0, 8); }
function invalidDiagnostic(record: CsvRecord, field: string, ruleCode: string, message: string, category: 'validation' | 'integrity' = 'validation', reason: 'invalid_field' | 'duplicate_value' = 'invalid_field') { return createDatasetDiagnostic(record, { category, field, message, reason, ruleCode, value: record.row[field] ?? null }); }
async function recordDiagnostics(diagnostics: DatasetImportDiagnosticsCollector, issues: Parameters<DatasetImportDiagnosticsCollector['record']>[0][]) { for (const issue of issues) await diagnostics.record(issue); }
