import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import { logger } from '@pkg/logger';
import { createDatabaseClient, resolveDatabaseUrl } from './index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(moduleDir, 'schema.sql');
const databaseUrl = resolveDatabaseUrl();

async function main() {
  const schema = await readFile(schemaPath, 'utf8');
  const client = createDatabaseClient(databaseUrl);

  try {
    await client.executeMultiple(schema);
    await migrateDatasetImportChunksSchema(client);
    await migrateDatasetImportRatingKeysSchema(client);
    await migrateSessionMovieFeedbackSchema(client);
    await migrateAnonymousSessionSchema(client);
    logger.info({ component: 'database', event: 'schema_applied' });
  } finally {
    await client.close();
  }
}

async function migrateDatasetImportRatingKeysSchema(client: Client): Promise<void> {
  const columns = await client.execute({ sql: 'PRAGMA table_info(dataset_import_rating_keys)', args: [] });
  const existingColumns = new Set(columns.rows.map((column) => String(column.name)));

  if (!existingColumns.has('chunk_id')) {
    await client.execute({ sql: "ALTER TABLE dataset_import_rating_keys ADD COLUMN chunk_id TEXT NOT NULL DEFAULT ''", args: [] });
  }
}

async function migrateDatasetImportChunksSchema(client: Client): Promise<void> {
  const columns = await client.execute({ sql: 'PRAGMA table_info(dataset_import_chunks)', args: [] });
  const existingColumns = new Set(columns.rows.map((column) => String(column.name)));

  if (!existingColumns.has('payload_path')) {
    await client.execute({ sql: "ALTER TABLE dataset_import_chunks ADD COLUMN payload_path TEXT NOT NULL DEFAULT ''", args: [] });
  }

  for (const column of ['processed_rows', 'imported_rows', 'rejected_rows', 'missing_dependency_rows']) {
    if (!existingColumns.has(column)) {
      await client.execute({ sql: `ALTER TABLE dataset_import_chunks ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`, args: [] });
    }
  }

  if (!existingColumns.has('rating_stats_materialized_at')) {
    await client.execute({ sql: 'ALTER TABLE dataset_import_chunks ADD COLUMN rating_stats_materialized_at TEXT', args: [] });
  }
}

async function migrateAnonymousSessionSchema(client: Client): Promise<void> {
  const columns = await client.execute({ sql: 'PRAGMA table_info(sessions)', args: [] });
  const existingColumns = new Set(columns.rows.map((column) => String(column.name)));

  if (!existingColumns.has('profile_id')) {
    await client.execute({ sql: 'ALTER TABLE sessions ADD COLUMN profile_id TEXT', args: [] });
  }

  if (!existingColumns.has('expires_at_ms')) {
    await client.execute({ sql: 'ALTER TABLE sessions ADD COLUMN expires_at_ms INTEGER', args: [] });
  }

  const recommendationRoundColumns = await client.execute({ sql: 'PRAGMA table_info(recommendation_rounds)', args: [] });
  const existingRecommendationRoundColumns = new Set(recommendationRoundColumns.rows.map((column) => String(column.name)));

  if (!existingRecommendationRoundColumns.has('model_version')) {
    await client.execute({ sql: 'ALTER TABLE recommendation_rounds ADD COLUMN model_version TEXT', args: [] });
  }

  await client.executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_anonymous_profiles_expires_at_ms ON anonymous_profiles (expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_anonymous_profile_movie_feedback_profile_id ON anonymous_profile_movie_feedback (profile_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_profile_expires_at_ms ON sessions (profile_id, expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_recommendation_rounds_profile_created_at_ms ON recommendation_rounds (profile_id, created_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_recommendation_rounds_session_sequence ON recommendation_rounds (session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_recommendation_impressions_round_position ON recommendation_impressions (round_id, position);
    CREATE INDEX IF NOT EXISTS idx_recommendation_impression_feedbacks_impression_id ON recommendation_impression_feedbacks (impression_id);
  `);
}

async function migrateSessionMovieFeedbackSchema(client: Client): Promise<void> {
  const result = await client.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_movie_feedback'",
    args: [],
  });
  const definition = String(result.rows[0]?.sql ?? '');

  if (!/FOREIGN KEY\s*\(\s*movie_id\s*\)\s*REFERENCES\s+movies/i.test(definition)) {
    return;
  }

  await client.executeMultiple(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE session_movie_feedback_next (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      movie_id TEXT NOT NULL,
      feedback TEXT NOT NULL CHECK (feedback IN ('watched', 'liked', 'disliked')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
      UNIQUE (session_id, movie_id, feedback)
    );
    INSERT INTO session_movie_feedback_next (id, session_id, movie_id, feedback, created_at)
      SELECT id, session_id, movie_id, feedback, created_at FROM session_movie_feedback;
    DROP TABLE session_movie_feedback;
    ALTER TABLE session_movie_feedback_next RENAME TO session_movie_feedback;
    CREATE INDEX idx_session_movie_feedback_session_id ON session_movie_feedback (session_id);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);

  logger.info({ component: 'database', event: 'session_feedback_schema_migrated' });
}

main().catch((error: unknown) => {
  logger.error({ component: 'database', error: error instanceof Error ? error.name : 'UnknownError', event: 'schema_failed' });
  process.exitCode = 1;
});
