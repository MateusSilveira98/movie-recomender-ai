import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient } from '@libsql/client';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import { createSqlSessionRepository } from './sessions.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('repositório de sessões anônimas', () => {
  it('deve preservar sinais de treino até completar a retenção de 180 dias', async () => {
    const context = await createTestContext();
    const nowMs = Date.now();
    const eventCreatedAtMs = nowMs - 100 * DAY_MS;

    try {
      const repository = createSqlSessionRepository(context.client);
      const profile = await repository.createAnonymousProfile('profile-id', 'token-hash', eventCreatedAtMs, nowMs - 1);
      const session = await repository.createSession({
        candidateCount: 1,
        createdAt: new Date(eventCreatedAtMs).toISOString(),
        expiresAtMs: nowMs - 1,
        history: { disliked: [], liked: [], watched: [] },
        id: 'session-id',
        preferences: { freeText: 'Não reter', genres: ['Drama'], runtime: 'medium' },
        profileId: profile.id,
        rankingVersion: 'heuristic-v1',
        roundId: 'round-id',
      });
      await repository.recordImpressions(session.roundId, [recommendation()], eventCreatedAtMs);

      const roundsWithinRetention = await repository.findRecentRounds(profile.id, nowMs - 180 * DAY_MS);

      assert.equal(roundsWithinRetention.length, 1);
      assert.equal(roundsWithinRetention[0]?.createdAt, new Date(eventCreatedAtMs).toISOString());

      await repository.cleanupExpired(nowMs);

      assert.equal(await count(context, 'recommendation_impressions'), 1);
      assert.equal(await value(context, 'SELECT status FROM sessions WHERE id = ?', ['session-id']), 'abandoned');
      assert.notEqual(await value(context, 'SELECT token_hash FROM anonymous_profiles WHERE id = ?', ['profile-id']), 'token-hash');
      assert.equal(await count(context, 'anonymous_profile_preferences'), 0);

      await repository.cleanupExpired(nowMs + 81 * DAY_MS);

      assert.equal(await count(context, 'recommendation_impressions'), 0);
      assert.equal(await count(context, 'recommendation_rounds'), 0);
      assert.equal(await repository.findRecentRounds(profile.id, nowMs - 99 * DAY_MS).then((rounds) => rounds.length), 0);
    } finally {
      await context.dispose();
    }
  });
});

async function createTestContext() {
  const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-sessions-'));
  const client = createClient({ url: `file:${join(directory, 'database.db')}` });
  await client.executeMultiple(await readFile('packages/database/src/schema.sql', 'utf8'));

  return {
    client,
    dispose: async () => {
      await client.close();
      await rm(directory, { force: true, recursive: true });
    },
  };
}

function recommendation(): Recommendation {
  return {
    adult: false,
    description: 'Descrição.',
    genres: ['Drama'],
    id: 'movie-id',
    popularity: 1,
    reason: 'Combina com Drama.',
    runtime: 100,
    score: 1,
    title: 'Filme',
    voteCount: 1,
    year: 2024,
  };
}

async function count(context: Awaited<ReturnType<typeof createTestContext>>, table: string): Promise<number> {
  const result = await context.client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function value(
  context: Awaited<ReturnType<typeof createTestContext>>,
  sql: string,
  args: string[],
): Promise<string | null> {
  const result = await context.client.execute({ args, sql });
  const item = result.rows[0];

  return item ? String(Object.values(item)[0]) : null;
}
