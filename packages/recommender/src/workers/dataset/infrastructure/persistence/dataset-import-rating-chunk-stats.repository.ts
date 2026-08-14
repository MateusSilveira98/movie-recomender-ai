import type { Client } from '@libsql/client';
import type { DatasetImportRatingChunkStats } from '../../domain/dataset-import-rating-chunk-stats.types.js';

export async function replaceDatasetImportRatingChunkStats(
  client: Client,
  chunkId: string,
  stats: readonly DatasetImportRatingChunkStats[],
): Promise<void> {
  await client.execute({
    sql: 'DELETE FROM dataset_import_rating_chunk_stats WHERE chunk_id = ?',
    args: [chunkId],
  });

  if (stats.length === 0) {
    return;
  }

  await client.batch(stats.map((item) => ({
    sql: `INSERT INTO dataset_import_rating_chunk_stats
      (chunk_id, movie_id, movie_lens_id, rating_count, rating_sum, rating_min, rating_max, rating_mean, rating_m2, first_rating_at, last_rating_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      chunkId,
      item.movieId,
      item.movieLensId,
      item.ratingCount,
      item.ratingSum,
      item.ratingMin,
      item.ratingMax,
      item.ratingMean,
      item.ratingM2,
      item.firstRatingAt,
      item.lastRatingAt,
    ],
  })), 'write');
}

export async function materializeDatasetImportRatingChunkStats(client: Client, chunkId: string): Promise<{
  ratingRecords: number;
  unresolvedRecords: number;
}> {
  const summary = await client.execute({
    sql: `SELECT COUNT(*) AS rating_records,
      SUM(CASE WHEN links.movie_lens_id IS NULL OR movies.id IS NULL THEN 1 ELSE 0 END) AS unresolved_records
      FROM dataset_import_rating_records ratings
      LEFT JOIN dataset_movie_links links ON links.movie_lens_id = ratings.movie_lens_id
      LEFT JOIN movies ON movies.id = links.tmdb_id
      WHERE ratings.chunk_id = ?`,
    args: [chunkId],
  });
  const ratingRecords = Number(summary.rows[0]?.rating_records ?? 0);
  const unresolvedRecords = Number(summary.rows[0]?.unresolved_records ?? 0);

  if (ratingRecords > 0) await client.execute({
    sql: `INSERT INTO dataset_import_rating_chunk_stats
      (chunk_id, movie_id, movie_lens_id, rating_count, rating_sum, rating_min, rating_max, rating_mean, rating_m2, first_rating_at, last_rating_at)
      SELECT ratings.chunk_id, movies.id, ratings.movie_lens_id, COUNT(*), SUM(ratings.rating), MIN(ratings.rating), MAX(ratings.rating),
        AVG(ratings.rating), MAX(0, SUM(ratings.rating * ratings.rating) - SUM(ratings.rating) * SUM(ratings.rating) / COUNT(*)),
        datetime(MIN(ratings.rated_at), 'unixepoch'), datetime(MAX(ratings.rated_at), 'unixepoch')
      FROM dataset_import_rating_records ratings
      JOIN dataset_movie_links links ON links.movie_lens_id = ratings.movie_lens_id
      JOIN movies ON movies.id = links.tmdb_id
      WHERE ratings.chunk_id = ?
      GROUP BY ratings.chunk_id, movies.id, ratings.movie_lens_id
      ON CONFLICT(chunk_id, movie_id) DO UPDATE SET
        movie_lens_id = excluded.movie_lens_id, rating_count = excluded.rating_count, rating_sum = excluded.rating_sum,
        rating_min = excluded.rating_min, rating_max = excluded.rating_max, rating_mean = excluded.rating_mean,
        rating_m2 = excluded.rating_m2, first_rating_at = excluded.first_rating_at, last_rating_at = excluded.last_rating_at`,
    args: [chunkId],
  });

  await client.execute({
    sql: `UPDATE dataset_import_chunks
      SET missing_dependency_rows = ?, rating_stats_materialized_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    args: [unresolvedRecords, chunkId],
  });

  return { ratingRecords, unresolvedRecords: 0 };
}

export async function persistAggregatedDatasetImportRatingStats(client: Client, jobId: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO movie_ratings_stats
      (movie_id, movie_lens_id, rating_count, rating_average, rating_sum, rating_min, rating_max, rating_stddev, first_rating_at, last_rating_at, created_at, updated_at)
      SELECT stats.movie_id, MIN(stats.movie_lens_id), SUM(stats.rating_count),
        SUM(stats.rating_sum) / SUM(stats.rating_count), SUM(stats.rating_sum), MIN(stats.rating_min), MAX(stats.rating_max),
        sqrt(MAX(0, (SUM(stats.rating_m2 + stats.rating_count * stats.rating_mean * stats.rating_mean)
          - SUM(stats.rating_sum) * SUM(stats.rating_sum) / SUM(stats.rating_count)) / SUM(stats.rating_count))),
        MIN(stats.first_rating_at), MAX(stats.last_rating_at), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM dataset_import_rating_chunk_stats stats
      JOIN dataset_import_chunks chunks ON chunks.id = stats.chunk_id
      WHERE chunks.job_id = ?
      GROUP BY stats.movie_id
      ON CONFLICT(movie_id) DO UPDATE SET movie_lens_id = excluded.movie_lens_id, rating_count = excluded.rating_count,
        rating_average = excluded.rating_average, rating_sum = excluded.rating_sum, rating_min = excluded.rating_min,
        rating_max = excluded.rating_max, rating_stddev = excluded.rating_stddev, first_rating_at = excluded.first_rating_at,
        last_rating_at = excluded.last_rating_at, updated_at = CURRENT_TIMESTAMP`,
    args: [jobId],
  });
}

export async function countDatasetImportRatingMissingDependencies(client: Client, jobId: string): Promise<number> {
  const result = await client.execute({
    sql: 'SELECT COALESCE(SUM(missing_dependency_rows), 0) AS count FROM dataset_import_chunks WHERE job_id = ?',
    args: [jobId],
  });
  return Number(result.rows[0]?.count ?? 0);
}

export async function resetWaitingDatasetImportRatingChunkMaterialization(client: Client): Promise<void> {
  await client.execute({
    sql: `UPDATE dataset_import_chunks
      SET missing_dependency_rows = 0, rating_stats_materialized_at = NULL
      WHERE job_id IN (
        SELECT jobs.id FROM dataset_import_jobs jobs
        JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id
        WHERE jobs.file_type = 'ratings' AND jobs.status = 'completed'
          AND uploads.status = 'partial_error' AND uploads.waiting_dependency_rows > 0
      )`,
    args: [],
  });
}

export async function listDatasetImportRatingChunksMissingStats(
  client: Client,
  jobId: string,
  limit: number,
): Promise<string[]> {
  const result = await client.execute({
    sql: `SELECT chunks.id
      FROM dataset_import_chunks chunks
      WHERE chunks.job_id = ? AND chunks.status = 'completed' AND chunks.imported_rows > 0
        AND chunks.rating_stats_materialized_at IS NULL
      ORDER BY chunks.sequence
      LIMIT ?`,
    args: [jobId, limit],
  });

  return result.rows.map((row) => String(row.id));
}

export async function listDatasetImportRatingChunkStatsForJob(
  client: Client,
  jobId: string,
): Promise<DatasetImportRatingChunkStats[]> {
  const result = await client.execute({
    sql: `SELECT stats.chunk_id, stats.movie_id, stats.movie_lens_id, stats.rating_count, stats.rating_sum, stats.rating_min, stats.rating_max,
      stats.rating_mean, stats.rating_m2, stats.first_rating_at, stats.last_rating_at
      FROM dataset_import_rating_chunk_stats stats
      JOIN dataset_import_chunks chunks ON chunks.id = stats.chunk_id
      WHERE chunks.job_id = ?
      ORDER BY stats.movie_id`,
    args: [jobId],
  });

  return result.rows.map(toDatasetImportRatingChunkStats);
}

export async function listDatasetImportRatingChunkStats(
  client: Client,
  chunkId: string,
): Promise<DatasetImportRatingChunkStats[]> {
  const result = await client.execute({
    sql: `SELECT chunk_id, movie_id, movie_lens_id, rating_count, rating_sum, rating_min, rating_max,
      rating_mean, rating_m2, first_rating_at, last_rating_at
      FROM dataset_import_rating_chunk_stats WHERE chunk_id = ? ORDER BY movie_id`,
    args: [chunkId],
  });

  return result.rows.map(toDatasetImportRatingChunkStats);
}

function toDatasetImportRatingChunkStats(row: Record<string, unknown>): DatasetImportRatingChunkStats {
  return {
    chunkId: String(row.chunk_id),
    firstRatingAt: nullableString(row.first_rating_at),
    lastRatingAt: nullableString(row.last_rating_at),
    movieId: String(row.movie_id),
    movieLensId: Number(row.movie_lens_id),
    ratingCount: Number(row.rating_count),
    ratingM2: Number(row.rating_m2),
    ratingMax: Number(row.rating_max),
    ratingMean: Number(row.rating_mean),
    ratingMin: Number(row.rating_min),
    ratingSum: Number(row.rating_sum),
  };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
