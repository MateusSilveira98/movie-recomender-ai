import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecommendationRanker } from '@pkg/recommender';
import {
  createBffTestContext,
  headersFor,
  request,
  sessionRequest,
  sessionRequestWithoutSignals,
  startProfile,
  WEB_ORIGIN,
  type SessionResponse,
} from '../../test-support/bff-test-context.js';

describe('BFF session HTTP API', () => {
  describe('anonymous profile and session lifecycle', () => {
    it('does not expose demo recommendations', async () => {
      const context = await createBffTestContext();
      try {
        assert.equal((await request(context, '/recommendations/demo')).status, 404);
      } finally { await context.dispose(); }
    });

    it('creates a session with recommendations safe for the public response', async () => {
      const context = await createBffTestContext();
      try {
        const profile = await startProfile(context);
        const response = await request(context, '/sessions', {
          body: JSON.stringify(sessionRequest()), headers: headersFor(profile), method: 'POST',
        });
        const body = await response.json() as SessionResponse;

        assert.equal(response.status, 201);
        assert.equal('id' in (body.session ?? {}), false);
        assert.ok(body.session);
        assert.equal(body.recommendations.length, 2);
        assert.ok(body.recommendations[0]?.impressionId);
        assert.ok(body.recommendations.every((recommendation) => Number.isInteger(recommendation.matchPercentage) && recommendation.matchPercentage >= 0 && recommendation.matchPercentage <= 100));
      } finally { await context.dispose(); }
    });

    it('rejects session creation without a CSRF token', async () => {
      const context = await createBffTestContext();
      try {
        const profile = await startProfile(context);
        const response = await request(context, '/sessions', {
          body: JSON.stringify(sessionRequest()),
          headers: { Cookie: profile.cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
          method: 'POST',
        });
        assert.equal(response.status, 403);
      } finally { await context.dispose(); }
    });

    it('rejects feedback from another anonymous profile', async () => {
      const context = await createBffTestContext();
      try {
        const owner = await startProfile(context);
        const created = await request(context, '/sessions', { body: JSON.stringify(sessionRequest()), headers: headersFor(owner), method: 'POST' });
        const state = await created.json() as SessionResponse;
        const otherProfile = await startProfile(context);
        await request(context, '/sessions', { body: JSON.stringify(sessionRequest()), headers: headersFor(otherProfile), method: 'POST' });
        const response = await request(context, '/sessions/feedback', {
          body: JSON.stringify({ feedback: 'liked', impressionId: state.recommendations[0]?.impressionId }), headers: headersFor(otherProfile), method: 'POST',
        });
        assert.equal(response.status, 404);
      } finally { await context.dispose(); }
    });

    it('returns an expired result when the session is no longer active', async () => {
      const context = await createBffTestContext();
      try {
        const profile = await startProfile(context);
        await request(context, '/sessions', { body: JSON.stringify(sessionRequest()), headers: headersFor(profile), method: 'POST' });
        await context.client.execute({ sql: 'UPDATE sessions SET expires_at_ms = ?', args: [Date.now() - 1] });
        const response = await request(context, '/sessions/recommendations', { headers: headersFor(profile), method: 'POST' });
        assert.equal(response.status, 410);
      } finally { await context.dispose(); }
    });

    it('returns persisted profile history and recommendation rounds after expiration', async () => {
      const context = await createBffTestContext();
      try {
        const profile = await startProfile(context);
        const created = await request(context, '/sessions', { body: JSON.stringify(sessionRequest()), headers: headersFor(profile), method: 'POST' });
        const createdState = await created.json() as SessionResponse;
        await request(context, '/sessions/feedback', { body: JSON.stringify({ feedback: 'liked', impressionId: createdState.recommendations[0]?.impressionId }), headers: headersFor(profile), method: 'POST' });
        await context.client.execute({ sql: 'UPDATE sessions SET expires_at_ms = ?', args: [Date.now() - 1] });
        await context.client.execute({ sql: 'UPDATE recommendation_impressions SET score = ?', args: [7.5] });

        const response = await request(context, '/sessions/current', { headers: { Cookie: profile.cookie, Origin: WEB_ORIGIN } });
        const body = await response.json() as { profile: { history: { liked: string[] } }; rounds: Array<{ movieTitles: Record<string, string>; recommendations: Array<{ id: string; impressionId?: string; matchPercentage: number; score: number }> }>; session: Record<string, unknown> | null };

        assert.equal(response.status, 200);
        assert.equal(body.session, null);
        assert.deepEqual(body.profile.history.liked, ['movie-a', createdState.recommendations[0]?.id]);
        assert.deepEqual(body.rounds[0]?.recommendations.map((recommendation) => recommendation.id), createdState.recommendations.map((recommendation) => recommendation.id));
        assert.deepEqual(body.rounds[0]?.recommendations.map((recommendation) => recommendation.score), [7.5, 7.5]);
        assert.equal(body.rounds[0]?.recommendations.some((recommendation) => recommendation.impressionId !== undefined), false);
        assert.equal(body.rounds[0]?.movieTitles['movie-a'], 'Drama A');
      } finally { await context.dispose(); }
    });
  });

  describe('when feedback changes the recommendation history', () => {
    it('excludes a rejected recommendation from the next session response', async () => {
      const context = await createBffTestContext();
      try {
        const profile = await startProfile(context);
        const created = await request(context, '/sessions', { body: JSON.stringify(sessionRequestWithoutSignals()), headers: headersFor(profile), method: 'POST' });
        const initialState = await created.json() as SessionResponse;
        const rejected = initialState.recommendations[0];
        assert.ok(rejected);
        const response = await request(context, '/sessions/feedback', { body: JSON.stringify({ feedback: 'disliked', impressionId: rejected.impressionId }), headers: headersFor(profile), method: 'POST' });
        const nextState = await response.json() as SessionResponse;
        assert.equal(response.status, 200);
        assert.equal(nextState.recommendations.some((recommendation) => recommendation.id === rejected.id), false);
        assert.deepEqual(nextState.profile.history.disliked, [rejected.id]);
      } finally { await context.dispose(); }
    });
  });

  describe('model ranking', () => {
    it('persists the model version returned by the ranker', async () => {
      const context = await createBffTestContext({ recommendationRanker: createRecommendationRanker({ modelScoreProvider: { getScores(movies) { return { modelVersion: 'quality-v1', scores: new Map(movies.map((movie) => [movie.id, 0.75])) }; } } }) });
      try {
        const profile = await startProfile(context);
        const response = await request(context, '/sessions', { body: JSON.stringify(sessionRequest()), headers: headersFor(profile), method: 'POST' });
        const round = await context.client.execute('SELECT ranking_version, model_version FROM recommendation_rounds');
        assert.equal(response.status, 201);
        assert.equal(round.rows[0]?.ranking_version, 'hybrid-v1');
        assert.equal(round.rows[0]?.model_version, 'quality-v1');
      } finally { await context.dispose(); }
    });

    it('uses model scores to order and persist recommendations', async () => {
      const context = await createBffTestContext({ recommendationRanker: createRecommendationRanker({ modelScoreProvider: { getScores(movies) { return { modelVersion: 'integration-v1', scores: new Map(movies.map((movie) => [movie.id, movie.id === 'movie-c' ? 1 : 0])) }; } } }) });
      try {
        const profile = await startProfile(context);
        const response = await request(context, '/sessions', { body: JSON.stringify(sessionRequestWithoutSignals()), headers: headersFor(profile), method: 'POST' });
        const body = await response.json() as SessionResponse;
        const impressions = await context.client.execute('SELECT movie_id, position FROM recommendation_impressions ORDER BY position ASC');
        assert.equal(response.status, 201);
        assert.deepEqual(body.recommendations.map((recommendation) => recommendation.id), ['movie-c', 'movie-a', 'movie-b']);
        assert.deepEqual(impressions.rows.map((row) => [row.movie_id, row.position]), [['movie-c', 1], ['movie-a', 2], ['movie-b', 3]]);
      } finally { await context.dispose(); }
    });

    it('keeps the heuristic order when the model provider fails', async () => {
      const context = await createBffTestContext({ recommendationRanker: createRecommendationRanker({ modelScoreProvider: { getScores() { throw new Error('Model unavailable'); } } }) });
      try {
        const profile = await startProfile(context);
        const response = await request(context, '/sessions', { body: JSON.stringify(sessionRequestWithoutSignals()), headers: headersFor(profile), method: 'POST' });
        const body = await response.json() as SessionResponse;
        assert.equal(response.status, 201);
        assert.deepEqual(body.recommendations.map((recommendation) => recommendation.id), ['movie-a', 'movie-b', 'movie-c']);
      } finally { await context.dispose(); }
    });
  });

  describe('cross-origin access control', () => {
    it('sets a secure cookie for an allowed cross-site origin', async () => {
      const origin = 'https://movie-recommender.pages.dev';

      await withEnvironment({ WEB_ORIGIN: origin }, async () => {
        const context = await createBffTestContext();
        try {
          const response = await request(context, '/sessions/current', { headers: { Origin: origin } });
          assert.equal(response.status, 200);
          assert.match(response.headers.get('set-cookie') ?? '', /SameSite=None/i);
          assert.match(response.headers.get('set-cookie') ?? '', /Secure/i);
        } finally { await context.dispose(); }
      });
    });

    it('rejects an unauthorized CORS origin without creating a profile', async () => {
      const context = await createBffTestContext();
      try {
        const origin = 'https://not-allowed.example';
        const response = await request(context, '/sessions/current', { headers: { Origin: origin } });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'Origem nao autorizada.' });
        assert.equal(response.headers.get('set-cookie'), null);
      } finally { await context.dispose(); }
    });

    it('rejects an unconfigured localhost origin in production', async () => {
      await withEnvironment({ NODE_ENV: 'production', WEB_ORIGIN: 'https://movie-recommender.pages.dev' }, async () => {
        const context = await createBffTestContext();
        try {
          const response = await request(context, '/sessions/current', { headers: { Origin: WEB_ORIGIN } });
          assert.equal(response.status, 403);
          assert.deepEqual(await response.json(), { error: 'Origem nao autorizada.' });
        } finally { await context.dispose(); }
      });
    });
  });
});

async function withEnvironment(values: Record<string, string>, action: () => Promise<void>): Promise<void> {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { await action(); } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
