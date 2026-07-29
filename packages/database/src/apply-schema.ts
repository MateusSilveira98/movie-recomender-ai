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
    await migrateSessionMovieFeedbackSchema(client);
    logger.info({ component: 'database', event: 'schema_applied' });
  } finally {
    await client.close();
  }
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
