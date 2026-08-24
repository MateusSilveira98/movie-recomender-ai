import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createQstashDatasetImportCommandPublisher } from './qstash-dataset-import-command.adapter.js';

const configuration = {
  callbackBaseUrl: 'https://movie-recommender-bff.onrender.com',
  currentSigningKey: 'current-key',
  nextSigningKey: 'next-key',
  token: 'qstash-token',
  url: 'https://qstash-us-east-1.upstash.io',
};

const command = {
  fileName: 'ratings.csv',
  objectKey: 'dataset-imports/upload-1/ratings.csv',
  sizeBytes: 10,
  type: 'ratings' as const,
  uploadId: 'upload-1',
};

describe('QStash dataset import command publisher', () => {
  describe('successful publish', () => {
    it('publishes the accepted upload command to the BFF callback URL', async () => {
      const calls: Array<{ destination: string; payload: unknown }> = [];
      const publisher = createQstashDatasetImportCommandPublisher(configuration, {
        async publishJson(destination, payload) {
          calls.push({ destination, payload });
        },
      });

      await publisher.publish(command);

      assert.deepEqual(calls, [{
        destination: 'https://movie-recommender-bff.onrender.com/internal/qstash/dataset-imports/commands',
        payload: command,
      }]);
    });
  });

  describe('invalid command', () => {
    it('rejects a command without an upload identifier before calling QStash', async () => {
      let called = false;
      const publisher = createQstashDatasetImportCommandPublisher(configuration, {
        async publishJson() {
          called = true;
        },
      });

      await assert.rejects(
        publisher.publish({ ...command, uploadId: '' }),
        { message: 'O comando de importação precisa conter metadados válidos.' },
      );
      assert.equal(called, false);
    });
  });
});
