import type { Client } from '@libsql/client';
import type { TrainingRecordRepository } from '../../application/ports/training-record.repository.port.js';
import type { MovieTrainingRecord } from '../../domain/models/movie-training-record.model.js';

export function createLibsqlTrainingRecordRepository(client: Client): TrainingRecordRepository {
  return { list: () => listTrainingRecords(client) };
}

async function listTrainingRecords(client: Client): Promise<MovieTrainingRecord[]> {
  const result = await client.execute({
    sql: `SELECT ratings.movie_id AS movieId, movies.popularity AS popularity, movies.vote_average AS voteAverage,
      ratings.rating_average AS ratingAverage, ratings.rating_count AS ratingCount, ratings.rating_stddev AS ratingStddev
      FROM movie_ratings_stats ratings JOIN movies ON movies.id = ratings.movie_id
      WHERE ratings.rating_count > 0 ORDER BY ratings.movie_id`,
  });

  return result.rows.map(toTrainingRecord);
}

function toTrainingRecord(row: Record<string, unknown>): MovieTrainingRecord {
  return {
    movieId: String(row.movieId),
    popularity: Number(row.popularity),
    ratingAverage: Number(row.ratingAverage),
    ratingCount: Number(row.ratingCount),
    ratingStddev: Number(row.ratingStddev),
    voteAverage: Number(row.voteAverage),
  };
}
