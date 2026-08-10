import type { Client } from '@libsql/client';
import { parsePositiveInteger, readCsvRecords, type CsvRecord } from '../../data/csv.reader.js';
import { createDatasetDiagnostic, validateDatasetRecord } from '../../validation/dataset-csv.validator.js';
import type { DatasetImportDiagnosticsCollector } from '../dataset-import-diagnostics.repository.js';
import { reserveDatasetImportRatingKeys } from '../dataset-import-rating-keys.repository.js';
import { flushStatements } from '../sql-statement.writer.js';
import type { LinkRecord, MovieRatingStats, SqlStatement } from '../../../domain/dataset.types.js';

const RATING_KEY_BATCH_SIZE = 1000;

export async function importRatingStats(
  client: Client,
  filePath: string,
  linksByMovieLensId: Map<number, LinkRecord>,
  knownMovieIds: Set<string>,
  diagnostics: DatasetImportDiagnosticsCollector,
  uploadId: string,
): Promise<RatingsImportResult> {
  const statsByMovieId = new Map<string, MovieRatingStats>();
  let importedRows = 0;
  let processedRows = 0;
  let rejectedRows = 0;
  let missingDependencyRows = 0;
  const pendingRatings: PendingRating[] = [];

  for await (const record of readCsvRecords(filePath)) {
    processedRows += 1;
    const validationIssues = validateDatasetRecord('ratings', record);

    if (validationIssues.length > 0) {
      await recordDiagnostics(diagnostics, validationIssues);
      rejectedRows += 1;
      continue;
    }

    const movieLensId = parsePositiveInteger(record.row.movieId);
    const userId = parsePositiveInteger(record.row.userId);
    const ratingValue = Number(record.row.rating);
    const timestamp = parsePositiveInteger(record.row.timestamp);

    if (movieLensId === null || userId === null || timestamp === null || !Number.isFinite(ratingValue)) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'validation',
        field: 'rating',
        message: 'Nao foi possivel normalizar a avaliacao.',
        reason: 'invalid_field',
        ruleCode: 'rating_normalization',
        value: record.row.rating ?? null,
      }));
      rejectedRows += 1;
      continue;
    }

    const link = linksByMovieLensId.get(movieLensId);

    if (!link) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'reference',
        field: 'movieId',
        message: 'O vinculo MovieLens referenciado nao foi encontrado.',
        reason: 'link_not_found',
        ruleCode: 'movielens_link_reference',
        value: record.row.movieId ?? null,
      }));
      missingDependencyRows += 1;
      continue;
    }

    const movieId = String(link.movieId);

    if (!knownMovieIds.has(movieId)) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'reference',
        field: 'movieId',
        message: 'O filme vinculado a avaliacao nao foi encontrado.',
        reason: 'movie_not_found',
        ruleCode: 'linked_movie_reference',
        value: movieId,
      }));
      missingDependencyRows += 1;
      continue;
    }

    pendingRatings.push({ movieId, movieLensId, ratingValue, record, timestamp, userId });

    if (pendingRatings.length >= RATING_KEY_BATCH_SIZE) {
      await reservePendingRatings();
    }
  }

  await reservePendingRatings();

  const statements: SqlStatement[] = [];

  for (const stats of statsByMovieId.values()) {
    statements.push(createRatingStatsStatement(stats));

    if (statements.length >= 200) {
      await flushStatements(client, statements);
    }
  }

  await flushStatements(client, statements);
  return { importedRows, missingDependencyRows, processedRows, rejectedRows };

  async function reservePendingRatings(): Promise<void> {
    if (pendingRatings.length === 0) {
      return;
    }

    const ratings = pendingRatings.splice(0, pendingRatings.length);
    const accepted = await reserveDatasetImportRatingKeys(
      client,
      uploadId,
      ratings.map((rating) => ({ movieLensId: rating.movieLensId, userId: rating.userId })),
    );

    for (const [index, rating] of ratings.entries()) {
      if (!accepted[index]) {
        await diagnostics.record(createDatasetDiagnostic(rating.record, {
          category: 'integrity',
          field: 'movieId',
          message: 'O usuario possui mais de uma avaliacao para o mesmo filme no arquivo.',
          reason: 'duplicate_value',
          ruleCode: 'duplicate_user_movie_rating',
          value: rating.record.row.movieId ?? null,
        }));
        rejectedRows += 1;
        continue;
      }

      const stats = statsByMovieId.get(rating.movieId) ?? createRatingStats(rating.movieId, rating.movieLensId, rating.ratingValue);
      updateRatingStats(stats, rating.ratingValue, rating.timestamp);
      statsByMovieId.set(rating.movieId, stats);
      importedRows += 1;
    }
  }
}

export interface RatingsImportResult {
  importedRows: number;
  missingDependencyRows: number;
  processedRows: number;
  rejectedRows: number;
}

interface PendingRating {
  movieId: string;
  movieLensId: number;
  ratingValue: number;
  record: CsvRecord;
  timestamp: number;
  userId: number;
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

async function recordDiagnostics(diagnostics: DatasetImportDiagnosticsCollector, issues: Parameters<DatasetImportDiagnosticsCollector['record']>[0][]): Promise<void> {
  for (const issue of issues) {
    await diagnostics.record(issue);
  }
}
