import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createQstashSignature } from '@pkg/recommender';
import { createBffTestContext, request } from '../../test-support/bff-test-context.js';

const qstash = {
  callbackBaseUrl: 'https://movie-recommender-bff.onrender.com',
  currentSigningKey: 'current-signing-key',
  nextSigningKey: 'next-signing-key',
  token: 'qstash-token',
  url: 'https://qstash-us-east-1.upstash.io',
};

const command = {
  fileName: 'ratings.csv',
  objectKey: 'dataset-imports/upload-1/ratings.csv',
  sizeBytes: 10,
  type: 'ratings',
  uploadId: 'upload-1',
};

describe('QStash dataset import command HTTP API', () => {
  describe('signature verification', () => {
    it('rejects a delivery without a valid QStash signature', async () => {
      const context = await createBffTestContext({ qstash });
      try {
        const response = await request(context, '/internal/qstash/dataset-imports/commands', {
          body: JSON.stringify(command),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: 'Assinatura QStash invalida.' });
      } finally {
        await context.dispose();
      }
    });
  });

  describe('accepted command', () => {
    it('processes a signed command', async () => {
      const processed: unknown[] = [];
      const context = await createBffTestContext({
        datasetImportCommandProcessor: async (received) => {
          processed.push(received);
        },
        qstash,
      });

      try {
        const body = JSON.stringify(command);
        const response = await request(context, '/internal/qstash/dataset-imports/commands', {
          body,
          headers: {
            'Content-Type': 'application/json',
            'Upstash-Signature': createQstashSignature(qstash.currentSigningKey, body),
          },
          method: 'POST',
        });

        assert.equal(response.status, 204);
        assert.deepEqual(processed, [command]);
      } finally {
        await context.dispose();
      }
    });
  });

  describe('invalid command processing', () => {
    it('prevents QStash from retrying a non-retryable command', async () => {
      const context = await createBffTestContext({
        datasetImportCommandProcessor: async () => {
          const error = new Error('Invalid CSV') as Error & { nonRetryable?: boolean };
          error.nonRetryable = true;
          throw error;
        },
        qstash,
      });

      try {
        const body = JSON.stringify(command);
        const response = await request(context, '/internal/qstash/dataset-imports/commands', {
          body,
          headers: {
            'Content-Type': 'application/json',
            'Upstash-Signature': createQstashSignature(qstash.currentSigningKey, body),
          },
          method: 'POST',
        });

        assert.equal(response.status, 400);
        assert.equal(response.headers.get('upstash-nonretryable-error'), 'true');
      } finally {
        await context.dispose();
      }
    });
  });
});
