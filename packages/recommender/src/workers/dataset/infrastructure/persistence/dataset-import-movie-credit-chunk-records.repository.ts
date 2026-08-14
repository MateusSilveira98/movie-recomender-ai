import type { Client } from '@libsql/client';
import type { CastRecord, CrewRecord, MovieRecord } from '../mappers/movie-record.mapper.js';

export interface StagedCreditRecord {
  cast: CastRecord[];
  crew: CrewRecord[];
  lineEnd: number;
  lineStart: number;
  movieId: string;
}

export interface StagedMovieRecord {
  lineEnd: number;
  lineStart: number;
  movie: MovieRecord;
}

export async function reserveMovieKeys(client: Client, uploadId: string, chunkId: string, movies: readonly MovieRecord[]): Promise<boolean[]> {
  const reservations = movies.flatMap((movie, movieIndex) => movieKeys(movie).map(([keyType, keyValue]) => ({ keyType, keyValue, movie, movieIndex })));
  if (reservations.length === 0) return [];

  const inserts = await client.batch(reservations.map((reservation) => ({
    sql: `INSERT OR IGNORE INTO dataset_import_movie_keys (upload_id, key_type, key_value, chunk_id, movie_id)
      VALUES (?, ?, ?, ?, ?)`,
    args: [uploadId, reservation.keyType, reservation.keyValue, chunkId, reservation.movie.id],
  })), 'write');
  const conflicts = reservations.filter((_, index) => inserts[index]?.rowsAffected !== 1);
  const existing = conflicts.length === 0 ? [] : await client.batch(conflicts.map((reservation) => ({
    sql: `SELECT chunk_id, movie_id FROM dataset_import_movie_keys WHERE upload_id = ? AND key_type = ? AND key_value = ?`,
    args: [uploadId, reservation.keyType, reservation.keyValue],
  })));
  const accepted = movies.map(() => true);

  conflicts.forEach((reservation, index) => {
    const row = existing[index]?.rows[0];
    if (String(row?.chunk_id ?? '') !== chunkId || String(row?.movie_id ?? '') !== reservation.movie.id) {
      accepted[reservation.movieIndex] = false;
    }
  });

  const insertedForRejectedMovies = reservations.filter((_, index) => inserts[index]?.rowsAffected === 1 && !accepted[reservations[index]!.movieIndex]);
  if (insertedForRejectedMovies.length > 0) {
    await client.batch(insertedForRejectedMovies.map((reservation) => ({
      sql: `DELETE FROM dataset_import_movie_keys WHERE upload_id = ? AND key_type = ? AND key_value = ? AND chunk_id = ? AND movie_id = ?`,
      args: [uploadId, reservation.keyType, reservation.keyValue, chunkId, reservation.movie.id],
    })), 'write');
  }

  return accepted;
}

function movieKeys(movie: MovieRecord): [string, string][] {
  const keys: [string, string][] = [['movie_id', movie.id]];
  if (movie.imdbId) keys.push(['imdb_id', movie.imdbId]);
  if (movie.movieLensId !== null) keys.push(['movie_lens_id', String(movie.movieLensId)]);
  return keys;
}

export async function replaceStagedMovieRecords(client: Client, chunkId: string, records: readonly StagedMovieRecord[]): Promise<void> {
  await clearStagedMovieRecords(client, chunkId);
  await appendStagedMovieRecords(client, chunkId, records);
}

export async function clearStagedMovieRecords(client: Client, chunkId: string): Promise<void> {
  await clearRecords(client, 'dataset_import_movie_chunk_records', chunkId);
}

export async function appendStagedMovieRecords(client: Client, chunkId: string, records: readonly StagedMovieRecord[]): Promise<void> {
  await appendRecords(client, 'dataset_import_movie_chunk_records', chunkId, records.map((record) => ({ ...record, movieId: record.movie.id })));
}

export async function listStagedMovieRecords(client: Client, chunkIds: readonly string[]): Promise<StagedMovieRecord[]> {
  const rows = await listRecords(client, 'dataset_import_movie_chunk_records', chunkIds);
  return rows.map((row) => JSON.parse(String(row.record_json)) as StagedMovieRecord);
}

export async function listStagedMovieRecordsPage(client: Client, chunkIds: readonly string[], limit: number, offset: number): Promise<StagedMovieRecord[]> {
  const rows = await listRecordsPage(client, 'dataset_import_movie_chunk_records', chunkIds, limit, offset);
  return rows.map((row) => JSON.parse(String(row.record_json)) as StagedMovieRecord);
}

export async function reserveCreditKey(client: Client, uploadId: string, chunkId: string, movieId: string): Promise<boolean> {
  const inserted = await client.execute({
    sql: 'INSERT OR IGNORE INTO dataset_import_credit_keys (upload_id, movie_id, chunk_id) VALUES (?, ?, ?)',
    args: [uploadId, movieId, chunkId],
  });
  if (inserted.rowsAffected === 1) return true;
  const existing = await client.execute({ sql: 'SELECT chunk_id FROM dataset_import_credit_keys WHERE upload_id = ? AND movie_id = ?', args: [uploadId, movieId] });
  return String(existing.rows[0]?.chunk_id ?? '') === chunkId;
}

export async function replaceStagedCreditRecords(client: Client, chunkId: string, records: readonly StagedCreditRecord[]): Promise<void> {
  await clearStagedCreditRecords(client, chunkId);
  await appendStagedCreditRecords(client, chunkId, records);
}

export async function clearStagedCreditRecords(client: Client, chunkId: string): Promise<void> {
  await clearRecords(client, 'dataset_import_credit_chunk_records', chunkId);
}

export async function appendStagedCreditRecords(client: Client, chunkId: string, records: readonly StagedCreditRecord[]): Promise<void> {
  await appendRecords(client, 'dataset_import_credit_chunk_records', chunkId, records);
}

export async function listStagedCreditRecords(client: Client, chunkIds: readonly string[]): Promise<StagedCreditRecord[]> {
  const rows = await listRecords(client, 'dataset_import_credit_chunk_records', chunkIds);
  return rows.map((row) => JSON.parse(String(row.record_json)) as StagedCreditRecord);
}

export async function listStagedCreditRecordsPage(client: Client, chunkIds: readonly string[], limit: number, offset: number): Promise<StagedCreditRecord[]> {
  const rows = await listRecordsPage(client, 'dataset_import_credit_chunk_records', chunkIds, limit, offset);
  return rows.map((row) => JSON.parse(String(row.record_json)) as StagedCreditRecord);
}

async function clearRecords(client: Client, table: 'dataset_import_movie_chunk_records' | 'dataset_import_credit_chunk_records', chunkId: string): Promise<void> {
  await client.execute({ sql: `DELETE FROM ${table} WHERE chunk_id = ?`, args: [chunkId] });
}

async function appendRecords(client: Client, table: 'dataset_import_movie_chunk_records' | 'dataset_import_credit_chunk_records', chunkId: string, records: readonly { lineEnd: number; lineStart: number; movieId: string }[]): Promise<void> {
  for (let index = 0; index < records.length; index += 100) {
    await client.batch(records.slice(index, index + 100).map((record) => ({
      sql: `INSERT INTO ${table} (chunk_id, line_start, line_end, movie_id, record_json) VALUES (?, ?, ?, ?, ?)`,
      args: [chunkId, record.lineStart, record.lineEnd, record.movieId, JSON.stringify(record)],
    })), 'write');
  }
}

async function listRecords(client: Client, table: 'dataset_import_movie_chunk_records' | 'dataset_import_credit_chunk_records', chunkIds: readonly string[]): Promise<Record<string, unknown>[]> {
  if (chunkIds.length === 0) return [];
  const result = await client.execute({
    sql: `SELECT line_start, line_end, record_json FROM ${table} WHERE chunk_id IN (${chunkIds.map(() => '?').join(', ')}) ORDER BY line_start`,
    args: [...chunkIds],
  });
  return result.rows as Record<string, unknown>[];
}

async function listRecordsPage(client: Client, table: 'dataset_import_movie_chunk_records' | 'dataset_import_credit_chunk_records', chunkIds: readonly string[], limit: number, offset: number): Promise<Record<string, unknown>[]> {
  if (chunkIds.length === 0) return [];
  const result = await client.execute({
    sql: `SELECT record_json FROM ${table} WHERE chunk_id IN (${chunkIds.map(() => '?').join(', ')}) ORDER BY line_start LIMIT ? OFFSET ?`,
    args: [...chunkIds, limit, offset],
  });
  return result.rows as Record<string, unknown>[];
}
