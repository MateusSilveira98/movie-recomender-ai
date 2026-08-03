import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient, type Client } from '@libsql/client';
import { createApp } from './app.js';

const WEB_ORIGIN = 'http://localhost:5173';

describe('API de perfil anônimo', () => {
  it('deve proteger sessão por cookie, CSRF e perfil proprietário', async () => {
    const context = await createTestContext();

    try {
      const firstProfile = await startProfile(context);
      const missingCsrf = await request(context, '/sessions', {
        body: JSON.stringify(sessionRequest()),
        headers: { Cookie: firstProfile.cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
        method: 'POST',
      });

      assert.equal(missingCsrf.status, 403);

      const createdSession = await request(context, '/sessions', {
        body: JSON.stringify(sessionRequest()),
        headers: headersFor(firstProfile),
        method: 'POST',
      });
      const createdState = await createdSession.json() as SessionResponse;

      assert.equal(createdSession.status, 201);
      assert.equal(createdSession.headers.get('access-control-allow-origin'), WEB_ORIGIN);
      assert.equal(createdSession.headers.get('access-control-allow-credentials'), 'true');
      assert.equal('id' in (createdState.session ?? {}), false);
      assert.ok(createdState.session);
      assert.equal(createdState.recommendations.length, 2);
      assert.ok(createdState.recommendations[0]?.impressionId);

      const feedbackResponse = await request(context, '/sessions/feedback', {
        body: JSON.stringify({ feedback: 'liked', impressionId: createdState.recommendations[0]?.impressionId }),
        headers: headersFor(firstProfile),
        method: 'POST',
      });
      const feedbackState = await feedbackResponse.json() as SessionResponse;

      assert.equal(feedbackResponse.status, 200);

      const secondProfile = await startProfile(context);
      const secondSession = await request(context, '/sessions', {
        body: JSON.stringify(sessionRequest()),
        headers: headersFor(secondProfile),
        method: 'POST',
      });

      assert.equal(secondSession.status, 201);

      const crossProfileFeedback = await request(context, '/sessions/feedback', {
        body: JSON.stringify({ feedback: 'liked', impressionId: createdState.recommendations[0]?.impressionId }),
        headers: headersFor(secondProfile),
        method: 'POST',
      });

      assert.equal(crossProfileFeedback.status, 404);

      await context.client.execute({ sql: 'UPDATE sessions SET expires_at_ms = ?', args: [Date.now() - 1] });
      const expiredSession = await request(context, '/sessions/recommendations', {
        headers: headersFor(firstProfile),
        method: 'POST',
      });

      assert.equal(expiredSession.status, 410);

      const returnedProfile = await request(context, '/sessions/current', {
        headers: { Cookie: firstProfile.cookie, Origin: WEB_ORIGIN },
      });
      const returnedState = await returnedProfile.json() as {
        profile: { history: { liked: string[] } };
        rounds: Array<{ recommendations: Array<{ id: string; impressionId?: string }> }>;
        session: Record<string, unknown> | null;
      };

      assert.equal(returnedProfile.status, 200);
      assert.equal(returnedState.session, null);
      assert.equal(returnedProfile.headers.get('set-cookie')?.split(';', 1)[0], firstProfile.cookie);
      assert.deepEqual(returnedState.profile.history.liked, ['movie-a', createdState.recommendations[0]?.id]);
      assert.deepEqual(
        returnedState.rounds[0]?.recommendations.map((recommendation) => recommendation.id),
        feedbackState.recommendations.map((recommendation) => recommendation.id),
      );
      assert.equal(returnedState.rounds[0]?.recommendations.some((recommendation) => recommendation.impressionId !== undefined), false);
    } finally {
      await context.dispose();
    }
  });

  it('deve configurar cookie seguro para uma origem cross-site autorizada', async () => {
    const originalWebOrigin = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = 'https://movie-recommender.pages.dev';
    const context = await createTestContext();

    try {
      const response = await request(context, '/sessions/current', {
        headers: { Origin: process.env.WEB_ORIGIN },
      });
      const setCookie = response.headers.get('set-cookie');

      assert.equal(response.status, 200);
      assert.ok(setCookie);
      assert.match(setCookie, /SameSite=None/i);
      assert.match(setCookie, /Secure/i);
    } finally {
      await context.dispose();

      if (originalWebOrigin === undefined) {
        delete process.env.WEB_ORIGIN;
      } else {
        process.env.WEB_ORIGIN = originalWebOrigin;
      }
    }
  });

  it('deve bloquear origem CORS não autorizada sem criar perfil', async () => {
    const context = await createTestContext();
    const unauthorizedOrigin = 'https://not-allowed.example';

    try {
      const getResponse = await request(context, '/sessions/current', { headers: { Origin: unauthorizedOrigin } });
      const optionsResponse = await request(context, '/sessions', {
        headers: {
          'Access-Control-Request-Method': 'POST',
          Origin: unauthorizedOrigin,
        },
        method: 'OPTIONS',
      });

      assert.equal(getResponse.status, 403);
      assert.deepEqual(await getResponse.json(), { error: 'Origem nao autorizada.' });
      assert.equal(getResponse.headers.get('access-control-allow-origin'), null);
      assert.equal(getResponse.headers.get('access-control-allow-credentials'), null);
      assert.equal(getResponse.headers.get('set-cookie'), null);
      assert.equal(optionsResponse.status, 403);
      assert.deepEqual(await optionsResponse.json(), { error: 'Origem nao autorizada.' });
    } finally {
      await context.dispose();
    }
  });

  it('deve bloquear localhost não configurado em produção', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalWebOrigin = process.env.WEB_ORIGIN;
    process.env.NODE_ENV = 'production';
    process.env.WEB_ORIGIN = 'https://movie-recommender.pages.dev';
    const context = await createTestContext();

    try {
      const response = await request(context, '/sessions/current', { headers: { Origin: WEB_ORIGIN } });

      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'Origem nao autorizada.' });
    } finally {
      await context.dispose();

      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }

      if (originalWebOrigin === undefined) {
        delete process.env.WEB_ORIGIN;
      } else {
        process.env.WEB_ORIGIN = originalWebOrigin;
      }
    }
  });
});

interface SessionResponse {
  csrfToken: string;
  recommendations: Array<{ id: string; impressionId: string }>;
  session: Record<string, unknown> | null;
}

interface StartedProfile {
  cookie: string;
  csrfToken: string;
}

async function createTestContext() {
  const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-bff-'));
  const client = createClient({ url: `file:${join(directory, 'database.db')}` });
  await client.executeMultiple(await readFile('packages/database/src/schema.sql', 'utf8'));
  await seedMovies(client);
  const app = createApp({ databaseClient: client, processDatasetQueue: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  return {
    client,
    dispose: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await client.close();
      await rm(directory, { force: true, recursive: true });
    },
    url: `http://127.0.0.1:${address.port}`,
  };
}

function headersFor(profile: StartedProfile): HeadersInit {
  return {
    Cookie: profile.cookie,
    'Content-Type': 'application/json',
    Origin: WEB_ORIGIN,
    'X-CSRF-Token': profile.csrfToken,
  };
}

async function startProfile(context: Awaited<ReturnType<typeof createTestContext>>): Promise<StartedProfile> {
  const response = await request(context, '/sessions/current', { headers: { Origin: WEB_ORIGIN } });
  const body = await response.json() as { csrfToken: string };
  const setCookie = response.headers.get('set-cookie');

  assert.equal(response.status, 200);
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/i);

  return { cookie: setCookie.split(';', 1)[0] ?? '', csrfToken: body.csrfToken };
}

function request(context: Awaited<ReturnType<typeof createTestContext>>, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${context.url}${path}`, init);
}

function sessionRequest() {
  return {
    history: { disliked: [], liked: ['movie-a'], watched: ['movie-a'] },
    preferences: { freeText: 'Não registrar', genres: ['Drama'], runtime: 'medium' },
  };
}

async function seedMovies(client: Client): Promise<void> {
  await client.batch(
    [
      movieStatement('movie-a', 'Drama A', 3),
      movieStatement('movie-b', 'Drama B', 2),
      movieStatement('movie-c', 'Comédia C', 1),
    ],
    'write',
  );
}

function movieStatement(id: string, title: string, popularity: number) {
  return {
    args: [id, `${id}-tmdb`, title, title, 2024, 100, popularity, popularity],
    sql: `INSERT INTO movies (
      id, tmdb_id, title, original_title, release_year, runtime_minutes, popularity, vote_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  };
}
