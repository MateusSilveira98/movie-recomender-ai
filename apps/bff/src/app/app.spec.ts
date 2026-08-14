import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient, type Client } from '@libsql/client';
import { createRecommendationRanker, type DatasetImportQueue, type RecommendationRanker } from '@pkg/recommender';
import express from 'express';
import { createListDatasetImportDiagnosticsController } from '../domains/dataset-imports/controllers/dataset-imports.controller.js';
import { requestErrorHandler } from '../middlewares/request-logger.middleware.js';
import { createApp } from './app.js';

const WEB_ORIGIN = 'http://localhost:5173';

describe('API de perfil anônimo', () => {
  it('não deve expor recomendações de demonstração', async () => {
    const context = await createTestContext();

    try {
      const response = await request(context, '/recommendations/demo');

      assert.equal(response.status, 404);
    } finally {
      await context.dispose();
    }
  });

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
      assert.ok(createdState.recommendations.every((recommendation) =>
        Number.isInteger(recommendation.matchPercentage) &&
        recommendation.matchPercentage >= 0 &&
        recommendation.matchPercentage <= 100,
      ));
      const persistedRound = await context.client.execute('SELECT ranking_version, model_version FROM recommendation_rounds');

      assert.equal(persistedRound.rows[0]?.ranking_version, 'hybrid-v1');
      assert.equal(persistedRound.rows[0]?.model_version, null);

      const feedbackResponse = await request(context, '/sessions/feedback', {
        body: JSON.stringify({ feedback: 'liked', impressionId: createdState.recommendations[0]?.impressionId }),
        headers: headersFor(firstProfile),
        method: 'POST',
      });

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

      await context.client.execute({ sql: 'UPDATE recommendation_impressions SET score = ?', args: [7.5] });

      const returnedProfile = await request(context, '/sessions/current', {
        headers: { Cookie: firstProfile.cookie, Origin: WEB_ORIGIN },
      });
      const returnedState = await returnedProfile.json() as {
        profile: { history: { liked: string[] } };
        rounds: Array<{ movieTitles: Record<string, string>; recommendations: Array<{ id: string; impressionId?: string; matchPercentage?: number; score: number }> }>;
        session: Record<string, unknown> | null;
      };

      assert.equal(returnedProfile.status, 200);
      assert.equal(returnedState.session, null);
      assert.equal(returnedProfile.headers.get('set-cookie')?.split(';', 1)[0], firstProfile.cookie);
      assert.deepEqual(returnedState.profile.history.liked, ['movie-a', createdState.recommendations[0]?.id]);
      assert.deepEqual(
        returnedState.rounds[0]?.recommendations.map((recommendation) => recommendation.id),
        createdState.recommendations.map((recommendation) => recommendation.id),
      );
      assert.deepEqual(returnedState.rounds[0]?.recommendations.map((recommendation) => recommendation.score), [7.5, 7.5]);
      assert.deepEqual(returnedState.rounds[0]?.recommendations.map((recommendation) => recommendation.matchPercentage), [100, 100]);
      assert.equal(returnedState.rounds[0]?.recommendations.some((recommendation) => recommendation.impressionId !== undefined), false);
      assert.equal(returnedState.rounds[0]?.movieTitles['movie-a'], 'Drama A');
      assert.equal(returnedState.rounds[0]?.movieTitles[createdState.recommendations[0]?.id ?? ''], 'Drama B');
    } finally {
      await context.dispose();
    }
  });

  it('deve persistir a versão do modelo fornecida pelo ranker', async () => {
    const context = await createTestContext({
      recommendationRanker: createRecommendationRanker({
        modelScoreProvider: {
          getScores(movies) {
            return {
              modelVersion: 'quality-v1',
              scores: new Map(movies.map((movie) => [movie.id, 0.75])),
            };
          },
        },
      }),
    });

    try {
      const profile = await startProfile(context);
      const response = await request(context, '/sessions', {
        body: JSON.stringify(sessionRequest()),
        headers: headersFor(profile),
        method: 'POST',
      });
      const persistedRound = await context.client.execute('SELECT ranking_version, model_version FROM recommendation_rounds');

      assert.equal(response.status, 201);
      assert.equal(persistedRound.rows[0]?.ranking_version, 'hybrid-v1');
      assert.equal(persistedRound.rows[0]?.model_version, 'quality-v1');
    } finally {
      await context.dispose();
    }
  });

  it('deve aplicar o score do modelo à ordem e à persistência das recomendações', async () => {
    const context = await createTestContext({
      recommendationRanker: createRecommendationRanker({
        modelScoreProvider: {
          getScores(movies) {
            return {
              modelVersion: 'integration-v1',
              scores: new Map(movies.map((movie) => [movie.id, movie.id === 'movie-c' ? 1 : 0])),
            };
          },
        },
      }),
    });

    try {
      const profile = await startProfile(context);
      const response = await request(context, '/sessions', {
        body: JSON.stringify(sessionRequestWithoutSignals()),
        headers: headersFor(profile),
        method: 'POST',
      });
      const body = await response.json() as SessionResponse;
      const impressions = await context.client.execute('SELECT movie_id, position FROM recommendation_impressions ORDER BY position ASC');
      const round = await context.client.execute('SELECT model_version FROM recommendation_rounds');

      assert.equal(response.status, 201);
      assert.deepEqual(body.recommendations.map((recommendation) => recommendation.id), ['movie-c', 'movie-a', 'movie-b']);
      assert.deepEqual(impressions.rows.map((row) => [row.movie_id, row.position]), [['movie-c', 1], ['movie-a', 2], ['movie-b', 3]]);
      assert.equal(round.rows[0]?.model_version, 'integration-v1');
    } finally {
      await context.dispose();
    }
  });

  it('deve manter a ordem heurística quando o provider do modelo falha', async () => {
    const context = await createTestContext({
      recommendationRanker: createRecommendationRanker({
        modelScoreProvider: {
          getScores() {
            throw new Error('modelo indisponível');
          },
        },
      }),
    });

    try {
      const profile = await startProfile(context);
      const response = await request(context, '/sessions', {
        body: JSON.stringify(sessionRequestWithoutSignals()),
        headers: headersFor(profile),
        method: 'POST',
      });
      const body = await response.json() as SessionResponse;
      const round = await context.client.execute('SELECT model_version FROM recommendation_rounds');

      assert.equal(response.status, 201);
      assert.deepEqual(body.recommendations.map((recommendation) => recommendation.id), ['movie-a', 'movie-b', 'movie-c']);
      assert.equal(round.rows[0]?.model_version, null);
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

describe('API de diagnósticos de importação', () => {
  it('deve bloquear importação sem chave administrativa válida', async () => {
    const context = await createTestContext({ datasetImportAdminToken: '' });

    try {
      const unavailable = await request(context, '/dataset-uploads');
      const protectedContext = await createTestContext({ datasetImportAdminToken: 'token-administrativo' });

      try {
        const denied = await request(protectedContext, '/dataset-uploads');
        const allowed = await request(protectedContext, '/dataset-uploads', {
          headers: { 'X-Dataset-Import-Token': 'token-administrativo' },
        });

        assert.equal(unavailable.status, 503);
        assert.equal(denied.status, 403);
        assert.equal(allowed.status, 200);
      } finally {
        await protectedContext.dispose();
      }
    } finally {
      await context.dispose();
    }
  });

  it('deve retornar erros paginados e validar os parâmetros de paginação', async () => {
    const context = await createTestContext({ datasetImportAdminToken: 'token-administrativo' });

    try {
      await context.client.batch([
        {
          sql: `INSERT INTO dataset_uploads (id, file_name, file_type, size_bytes, status)
            VALUES (?, ?, ?, ?, ?)`,
          args: ['upload-com-erros', 'links.csv', 'links', 10, 'partial_error'],
        },
        {
          sql: `INSERT INTO dataset_import_jobs (id, upload_id, file_type, status)
            VALUES (?, ?, ?, ?)`,
          args: ['job-com-erros', 'upload-com-erros', 'links', 'completed'],
        },
        {
          sql: `INSERT INTO dataset_import_diagnostics (
            id, upload_id, line_start, line_end, field_name, value_preview, diagnostic_category, reason, rule_code, message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: ['diagnostico-1', 'upload-com-erros', 3, 3, 'tmdbId', 'abc', 'validation', 'invalid_field', 'positive_integer_required', 'O campo deve ser inteiro.'],
        },
        {
          sql: `INSERT INTO dataset_import_diagnostic_summaries (
            upload_id, diagnostic_category, field_name, reason, rule_code, count
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          args: ['upload-com-erros', 'validation', 'tmdbId', 'invalid_field', 'positive_integer_required', 1],
        },
      ], 'write');

      const importHeaders = { 'X-Dataset-Import-Token': 'token-administrativo' };
      const response = await request(context, '/dataset-uploads/upload-com-erros/diagnostics?limit=1&offset=0', { headers: importHeaders });
      const body = await response.json() as {
        diagnostics: Array<{ field: string; fileName: string; lineStart: number }>;
        page: { detectedTotal: number; total: number; truncated: boolean };
        summary: Array<{ category: string; count: number; field: string; reason: string; ruleCode: string }>;
      };
      const invalidPagination = await request(context, '/dataset-uploads/upload-com-erros/diagnostics?limit=101', { headers: importHeaders });
      const missingUpload = await request(context, '/dataset-uploads/inexistente/diagnostics', { headers: importHeaders });

      assert.equal(response.status, 200);
      assert.equal(body.page.total, 1);
      assert.equal(body.page.detectedTotal, 1);
      assert.equal(body.page.truncated, false);
      assert.deepEqual(body.diagnostics.map((diagnostic) => ({ field: diagnostic.field, fileName: diagnostic.fileName, lineStart: diagnostic.lineStart })), [
        { field: 'tmdbId', fileName: 'links.csv', lineStart: 3 },
      ]);
      assert.deepEqual(body.summary, [{ category: 'validation', count: 1, field: 'tmdbId', reason: 'invalid_field', ruleCode: 'positive_integer_required' }]);
      assert.equal(invalidPagination.status, 400);
      assert.equal(missingUpload.status, 404);
    } finally {
      await context.dispose();
    }
  });

  it('deve devolver JSON de erro quando a consulta de diagnósticos falhar', async () => {
    const app = express();
    const queue: DatasetImportQueue = {
      enqueue: async () => { throw new Error('Não utilizado neste teste.'); },
      findUpload: async () => null,
      listDiagnostics: async () => { throw new Error('LibSQL indisponível.'); },
      listJobs: async () => [],
      listUploads: async () => [],
      processPending: async () => undefined,
    };

    app.get('/dataset-uploads/:uploadId/diagnostics', createListDatasetImportDiagnosticsController(queue));
    app.use(requestErrorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/dataset-uploads/upload-falhou/diagnostics`);

      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Nao foi possivel concluir a requisicao.' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe('Inicialização do BFF', () => {
  it('deve manter o health disponível quando a limpeza inicial falhar', async () => {
    const app = createApp({
      databaseClient: {
        batch: async () => { throw new Error('LibSQL indisponível.'); },
      } as unknown as Client,
      processDatasetQueue: false,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);

      assert.equal(response.status, 200);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

interface SessionResponse {
  csrfToken: string;
  recommendations: Array<{ id: string; impressionId: string; matchPercentage: number }>;
  session: Record<string, unknown> | null;
}

interface StartedProfile {
  cookie: string;
  csrfToken: string;
}

async function createTestContext(options: { datasetImportAdminToken?: string; recommendationRanker?: RecommendationRanker } = {}) {
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

function sessionRequestWithoutSignals() {
  return {
    history: { disliked: [], liked: [], watched: [] },
    preferences: { freeText: '', genres: [], runtime: 'any' },
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
