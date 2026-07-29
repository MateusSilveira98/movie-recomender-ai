import type { Client } from '@libsql/client';
import { parsePositiveInteger, readCsv } from '../../data/csv.reader.js';
import { flushStatements } from '../sql-statement.writer.js';
import type { LinkRecord, MovieRatingStats, SqlStatement } from '../../../domain/dataset.types.js';

export async function importRatingStats(
  client: Client,
  filePath: string,
  linksByMovieLensId: Map<number, LinkRecord>,
  knownMovieIds: Set<string>,
): Promise<RatingsImportResult> {
  const statsByMovieId = new Map<string, MovieRatingStats>();
  let processedRows = 0;
  let rejectedRows = 0;
  let missingDependencyRows = 0;

  for await (const row of readCsv(filePath)) {
    processedRows += 1;
    const movieLensId = parsePositiveInteger(row.movieId);
    const ratingValue = Number(row.rating);
    const timestamp = Number(row.timestamp);

    if (movieLensId === null || !Number.isFinite(ratingValue) || !Number.isFinite(timestamp)) {
      rejectedRows += 1;
      continue;
    }

    const link = linksByMovieLensId.get(movieLensId);
    const movieId = link ? String(link.movieId) : null;

    if (!movieId || !knownMovieIds.has(movieId)) {
      missingDependencyRows += 1;
      continue;
    }

    const stats = statsByMovieId.get(movieId) ?? createRatingStats(movieId, movieLensId, ratingValue);
    updateRatingStats(stats, ratingValue, timestamp);
    statsByMovieId.set(movieId, stats);
  }

  const statements: SqlStatement[] = [];

  for (const stats of statsByMovieId.values()) {
    statements.push(createRatingStatsStatement(stats));

    if (statements.length >= 200) {
      await flushStatements(client, statements);
    }
  }

  await flushStatements(client, statements);
  return { importedRows: statsByMovieId.size, missingDependencyRows, processedRows, rejectedRows };
}

export interface RatingsImportResult {
  importedRows: number;
  missingDependencyRows: number;
  processedRows: number;
  rejectedRows: number;
}

function createRatingStats(movieId: string, movieLensId: number, ratingValue: number): MovieRatingStats {
  return { count: 0, firstTimestamp: null, lastTimestamp: null, max: ratingValue, mean: 0, min: ratingValue, movieId, movieLensId, m2: 0, sum: 0 };
}

function updateRatingStats(stats: MovieRatingStats, ratingValue: number, timestamp: number): void {
  stats.count += 1;
  stats.sum += ratingValue;
  stats.min = Math.min(stats.min, ratingValue);
  stats.max = Math.max(stats.max, ratingValue);
  const delta = ratingValue - stats.mean;
  stats.mean += delta / stats.count;
  stats.m2 += delta * (ratingValue - stats.mean);
  stats.firstTimestamp = stats.firstTimestamp === null ? timestamp : Math.min(stats.firstTimestamp, timestamp);
  stats.lastTimestamp = stats.lastTimestamp === null ? timestamp : Math.max(stats.lastTimestamp, timestamp);
}

function createRatingStatsStatement(stats: MovieRatingStats): SqlStatement {
  const ratingStddev = stats.count > 0 ? Math.sqrt(stats.m2 / stats.count) : 0;

  return [
    `INSERT INTO movie_ratings_stats (movie_id, movie_lens_id, rating_count, rating_average, rating_sum, rating_min, rating_max, rating_stddev, first_rating_at, last_rating_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(movie_id) DO UPDATE SET movie_lens_id = excluded.movie_lens_id, rating_count = excluded.rating_count,
        rating_average = excluded.rating_average, rating_sum = excluded.rating_sum, rating_min = excluded.rating_min,
        rating_max = excluded.rating_max, rating_stddev = excluded.rating_stddev, first_rating_at = excluded.first_rating_at,
        last_rating_at = excluded.last_rating_at, updated_at = CURRENT_TIMESTAMP`,
    [stats.movieId, stats.movieLensId, stats.count, stats.count > 0 ? stats.sum / stats.count : 0, stats.sum, stats.min, stats.max, ratingStddev, stats.firstTimestamp ? new Date(stats.firstTimestamp * 1000).toISOString() : null, stats.lastTimestamp ? new Date(stats.lastTimestamp * 1000).toISOString() : null],
  ];
}
