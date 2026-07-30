import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createClient, type Client } from '@libsql/client';
import { runTrainingJob } from './train.js';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalModelDirectory = process.env.TRAINING_MODEL_DIR;
const directories: string[] = [];

afterEach(async () => {
  process.env.DATABASE_URL = originalDatabaseUrl;
  process.env.TRAINING_MODEL_DIR = originalModelDirectory;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('runTrainingJob', () => {
  it('treina e exporta um modelo TensorFlow.js a partir das estatísticas agregadas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-ml-'));
    directories.push(directory);
    const databasePath = join(directory, 'training.db');
    const modelDirectory = join(directory, 'model');
    process.env.DATABASE_URL = `file:${databasePath}`;
    process.env.TRAINING_MODEL_DIR = modelDirectory;
    const client = createClient({ url: process.env.DATABASE_URL });

    try {
      await seedTrainingDatabase(client);
      const result = await runTrainingJob();

      assert.equal(result.status, 'trained');
      assert.equal(result.trainingRecordCount, 4);
      assert.ok(result.metrics.mae >= 0);
      assert.ok(result.metrics.mse >= 0);
      assert.equal(JSON.parse(await readFile(join(modelDirectory, 'model.json'), 'utf8')).format, 'layers-model');
      assert.deepEqual(JSON.parse(await readFile(join(modelDirectory, 'training-metadata.json'), 'utf8')).featureScales, {
        popularity: 20,
        ratingCountLog: Math.log1p(100),
        ratingStddev: 1,
        voteAverage: 10,
      });
    } finally {
      await client.close();
    }
  });
});

async function seedTrainingDatabase(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE movies (id TEXT PRIMARY KEY, popularity REAL NOT NULL, vote_average REAL NOT NULL);
    CREATE TABLE movie_ratings_stats (movie_id TEXT PRIMARY KEY, rating_average REAL NOT NULL, rating_count INTEGER NOT NULL, rating_stddev REAL NOT NULL);
    INSERT INTO movies VALUES ('1', 10, 8), ('2', 20, 7), ('3', 5, 6), ('4', 200, 9);
    INSERT INTO movie_ratings_stats VALUES ('1', 4, 100, 0.5), ('2', 3, 25, 1), ('3', 2.5, 4, 0.75), ('4', 4.5, 500, 0.25);
  `);
}
