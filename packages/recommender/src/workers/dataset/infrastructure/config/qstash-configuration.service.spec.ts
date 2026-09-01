import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { getQstashConfiguration, qstashDatasetImportCommandUrl } from './qstash-configuration.service.js';

const validEnvironment = {
  APP_ENV: 'production',
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
        () => getQstashConfiguration({ APP_ENV: 'production', QSTASH_TOKEN: 'token' }),
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

  describe('non-production environment', () => {
    it('keeps RabbitMQ when QStash credentials are configured outside production', () => {
      assert.equal(getQstashConfiguration({ ...validEnvironment, APP_ENV: 'development' }), null);
      assert.equal(getQstashConfiguration({ ...validEnvironment, APP_ENV: 'staging', NODE_ENV: 'development' }), null);
    });
  });

  describe('secret files', () => {
    it('reads QStash credentials from secret files instead of environment values', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'qstash-secrets-'));
      const tokenFile = join(directory, 'token');
      const currentKeyFile = join(directory, 'current-key');
      const nextKeyFile = join(directory, 'next-key');

      try {
        await Promise.all([
          writeFile(tokenFile, 'token-from-file\n'),
          writeFile(currentKeyFile, 'current-key-from-file\n'),
          writeFile(nextKeyFile, 'next-key-from-file\n'),
        ]);
        const configuration = getQstashConfiguration({
          APP_ENV: 'production',
          QSTASH_CALLBACK_BASE_URL: validEnvironment.QSTASH_CALLBACK_BASE_URL,
          QSTASH_CURRENT_SIGNING_KEY_FILE: currentKeyFile,
          QSTASH_NEXT_SIGNING_KEY_FILE: nextKeyFile,
          QSTASH_TOKEN_FILE: tokenFile,
          QSTASH_URL: validEnvironment.QSTASH_URL,
        });

        assert.ok(configuration);
        assert.equal(configuration.token, 'token-from-file');
        assert.equal(configuration.currentSigningKey, 'current-key-from-file');
        assert.equal(configuration.nextSigningKey, 'next-key-from-file');
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    });

    it('reports only values missing after resolving secret files', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'qstash-secrets-'));
      const tokenFile = join(directory, 'token');
      const currentKeyFile = join(directory, 'current-key');
      const nextKeyFile = join(directory, 'next-key');

      try {
        await Promise.all([
          writeFile(tokenFile, 'token-from-file\n'),
          writeFile(currentKeyFile, 'current-key-from-file\n'),
          writeFile(nextKeyFile, 'next-key-from-file\n'),
        ]);

        assert.throws(
          () => getQstashConfiguration({
            APP_ENV: 'production',
            QSTASH_CURRENT_SIGNING_KEY_FILE: currentKeyFile,
            QSTASH_NEXT_SIGNING_KEY_FILE: nextKeyFile,
            QSTASH_TOKEN_FILE: tokenFile,
            QSTASH_URL: validEnvironment.QSTASH_URL,
          }),
          { message: 'QStash está incompleto. Defina QSTASH_CALLBACK_BASE_URL.' },
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    });
  });
});
