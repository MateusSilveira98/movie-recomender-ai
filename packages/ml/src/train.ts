import { createDatabaseClient, resolveDatabaseUrl } from '@pkg/database';

export interface TrainingJobResult {
  status: 'not-trained-yet';
  modelName: 'movie-recommender-baseline';
  databaseUrl: string;
  movieCount: number;
  ratingStatsCount: number;
}

export async function runTrainingJob(): Promise<TrainingJobResult> {
  const client = createDatabaseClient();

  try {
    const movieCount = await countRows(client, 'movies');
    const ratingStatsCount = await countRows(client, 'movie_ratings_stats');

    return {
      status: 'not-trained-yet',
      modelName: 'movie-recommender-baseline',
      databaseUrl: resolveDatabaseUrl(),
      movieCount,
      ratingStatsCount,
    };
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTrainingJob()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

async function countRows(client: ReturnType<typeof createDatabaseClient>, tableName: string): Promise<number> {
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS count FROM ${tableName}`,
  });

  const firstRow = result.rows[0];

  return typeof firstRow?.count === 'number' ? firstRow.count : Number(firstRow?.count ?? 0);
}
