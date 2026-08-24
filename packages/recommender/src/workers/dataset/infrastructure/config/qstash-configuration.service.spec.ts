import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getQstashConfiguration, qstashDatasetImportCommandUrl } from './qstash-configuration.service.js';

const validEnvironment = {
  QSTASH_CALLBACK_BASE_URL: 'https://movie-recommender-bff.onrender.com/',
  QSTASH_CURRENT_SIGNING_KEY: 'current-key',
  QSTASH_NEXT_SIGNING_KEY: 'next-key',
  QSTASH_TOKEN: 'token',
  QSTASH_URL: 'https://qstash-us-east-1.upstash.io',
};

describe('QStash configuration', () => {
  describe('empty environment', () => {
    it('keeps RabbitMQ as the default transport when no QStash variable is set', () => {
      assert.equal(getQstashConfiguration({}), null);
    });
  });

  describe('partial configuration', () => {
    it('rejects a QStash setup that is missing required variables', () => {
      assert.throws(
        () => getQstashConfiguration({ QSTASH_TOKEN: 'token' }),
        { message: 'QStash está incompleto. Defina QSTASH_URL, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY, QSTASH_CALLBACK_BASE_URL.' },
      );
    });
  });

  describe('valid configuration', () => {
    it('normalizes the callback URL used to receive import commands', () => {
      const configuration = getQstashConfiguration(validEnvironment);

      assert.ok(configuration);
      assert.equal(configuration.url, 'https://qstash-us-east-1.upstash.io');
      assert.equal(
        qstashDatasetImportCommandUrl(configuration),
        'https://movie-recommender-bff.onrender.com/internal/qstash/dataset-imports/commands',
      );
    });
  });
});
