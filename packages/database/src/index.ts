import { createClient, type Client } from '@libsql/client';

export interface DatabaseHealth {
  provider: 'local-libsql' | 'remote-turso';
  status: 'ready' | 'degraded';
  url: string;
}

export interface DatabaseSchemaManifest {
  name: 'movie-recomender-ai';
  tables: readonly string[];
}

export const DATABASE_SCHEMA_MANIFEST: DatabaseSchemaManifest = {
  name: 'movie-recomender-ai',
  tables: [
    'movies',
    'movie_genres',
    'movie_cast',
    'movie_crew',
    'movie_features',
    'movie_ratings_stats',
    'dataset_import_runs',
    'dataset_movie_links',
    'dataset_uploads',
    'dataset_import_jobs',
    'sessions',
    'session_preferences',
    'session_movie_feedback',
    'recommendation_events',
    'recommendation_feedback',
  ],
};

export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? 'file:./movie-recomender-ai.db';
}

export function resolveDatabaseAuthToken(): string | undefined {
  return process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;
}

export function createDatabaseClient(databaseUrl = resolveDatabaseUrl()): Client {
  const authToken = resolveDatabaseAuthToken();

  if (authToken) {
    return createClient({ url: databaseUrl, authToken });
  }

  return createClient({ url: databaseUrl });
}

export async function getDatabaseHealth(): Promise<DatabaseHealth> {
  const url = resolveDatabaseUrl();

  return {
    provider: isRemoteDatabaseUrl(url) ? 'remote-turso' : 'local-libsql',
    status: 'ready',
    url,
  };
}

function isRemoteDatabaseUrl(url: string): boolean {
  return url.startsWith('libsql://') || url.startsWith('https://');
}
