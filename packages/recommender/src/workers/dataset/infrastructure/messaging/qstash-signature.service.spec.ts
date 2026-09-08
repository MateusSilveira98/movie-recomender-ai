import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createQstashSignature, verifyQstashSignature } from './qstash-signature.service.js';

const keys = {
  currentSigningKey: 'current-signing-key',
  nextSigningKey: 'next-signing-key',
};
const destination = 'https://movie-recommender-bff.onrender.com/internal/qstash/dataset-imports/commands';

describe('QStash signature verification', () => {
  describe('valid signature', () => {
    it('accepts a payload signed with the current key', async () => {
      const body = '{"uploadId":"upload-1"}';
      const signature = createQstashSignature(keys.currentSigningKey, body, destination);

      assert.equal(await verifyQstashSignature(keys, { body, signature, url: destination }), true);
    });

    it('accepts a payload signed with the next key during rotation', async () => {
      const body = '{"uploadId":"upload-1"}';
      const signature = createQstashSignature(keys.nextSigningKey, body, destination);

      assert.equal(await verifyQstashSignature(keys, { body, signature, url: destination }), true);
    });
  });

  describe('invalid signature', () => {
    it('rejects a payload signed with an unknown key', async () => {
      const body = '{"uploadId":"upload-1"}';
      const signature = createQstashSignature('other-key', body, destination);

      assert.equal(await verifyQstashSignature(keys, { body, signature, url: destination }), false);
    });

    it('rejects a valid signature when the body does not match', async () => {
      const signature = createQstashSignature(keys.currentSigningKey, '{"uploadId":"upload-1"}', destination);

      assert.equal(await verifyQstashSignature(keys, { body: '{"uploadId":"tampered"}', signature, url: destination }), false);
    });

    it('rejects a valid signature when the destination URL does not match', async () => {
      const body = '{"uploadId":"upload-1"}';
      const signature = createQstashSignature(keys.currentSigningKey, body, destination);

      assert.equal(await verifyQstashSignature(keys, {
        body,
        signature,
        url: 'https://other-host.example.com/internal/qstash/dataset-imports/commands',
      }), false);
    });
  });
});
