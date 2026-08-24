import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import type { DatasetImportCommand, QstashConfiguration, RecommendationRanker } from '@pkg/recommender';
import { createApp } from '../app/app.js';

export const WEB_ORIGIN = 'http://localhost:5173';

export interface SessionResponse {
  csrfToken: string;
  profile: { history: { disliked: string[] } };
  recommendations: Array<{ id: string; impressionId: string; matchPercentage: number }>;
  session: Record<string, unknown> | null;
}

export interface StartedProfile {
  cookie: string;
  csrfToken: string;
}

export interface BffTestContext {
  client: Client;
  dispose(): Promise<void>;
  url: string;
}

interface BffTestContextOptions {
  datasetImportAdminToken?: string;
  datasetImportCommandProcessor?: (command: DatasetImportCommand) => Promise<void>;
  qstash?: QstashConfiguration | null;
  recommendationRanker?: RecommendationRanker;
}

export async function createBffTestContext(options: BffTestContextOptions = {}): Promise<BffTestContext> {
  const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-bff-'));
  const client = createClient({ url: `file:${join(directory, 'database.db')}` });
  await client.executeMultiple(await readFile('packages/database/src/schema.sql', 'utf8'));
  await seedMovies(client);
  const app = createApp({ databaseClient: client, processDatasetQueue: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  return {
    client,
    async dispose() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await client.close();
      await rm(directory, { force: true, recursive: true });
    },
    url: `http://127.0.0.1:${address.port}`,
  };
}

export function headersFor(profile: StartedProfile): HeadersInit {
  return {
    Cookie: profile.cookie,
    'Content-Type': 'application/json',
    Origin: WEB_ORIGIN,
    'X-CSRF-Token': profile.csrfToken,
  };
}

export async function startProfile(context: BffTestContext): Promise<StartedProfile> {
  const response = await request(context, '/sessions/current', { headers: { Origin: WEB_ORIGIN } });
  const body = await response.json() as { csrfToken: string };
  const setCookie = response.headers.get('set-cookie');

  assert.equal(response.status, 200);
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/i);

  return { cookie: setCookie.split(';', 1)[0] ?? '', csrfToken: body.csrfToken };
}

export function request(context: BffTestContext, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${context.url}${path}`, init);
}

export function sessionRequest() {
  return {
    history: { disliked: [], liked: ['movie-a'], watched: ['movie-a'] },
    preferences: { freeText: 'Do not persist', genres: ['Drama'], runtime: 'medium' },
  };
}

export function sessionRequestWithoutSignals() {
  return {
    history: { disliked: [], liked: [], watched: [] },
    preferences: { freeText: '', genres: [], runtime: 'any' },
  };
}

async function seedMovies(client: Client): Promise<void> {
  await client.batch([
    movieStatement('movie-a', 'Drama A', 3),
    movieStatement('movie-b', 'Drama B', 2),
    movieStatement('movie-c', 'Comedy C', 1),
  ], 'write');
}

function movieStatement(id: string, title: string, popularity: number) {
  return {
    args: [id, `${id}-tmdb`, title, title, 2024, 100, popularity, popularity],
    sql: `INSERT INTO movies (
      id, tmdb_id, title, original_title, release_year, runtime_minutes, popularity, vote_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  };
}
