import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createQstashSignature, verifyQstashSignature } from './qstash-signature.service.js';

const keys = {
  currentSigningKey: 'current-signing-key',
  nextSigningKey: 'next-signing-key',
};

describe('QStash signature verification', () => {
  describe('valid signature', () => {
    it('accepts a payload signed with the current key', () => {
      const body = '{"uploadId":"upload-1"}';
      const signature = createQstashSignature(keys.currentSigningKey, body);

      assert.equal(verifyQstashSignature(keys, { body, signature }), true);
    });

    it('accepts a payload signed with the next key during rotation', () => {
      const body = '{"uploadId":"upload-1"}';
      const signature = createQstashSignature(keys.nextSigningKey, body);

      assert.equal(verifyQstashSignature(keys, { body, signature }), true);
    });
  });

  describe('invalid signature', () => {
    it('rejects a payload signed with an unknown key', () => {
      const body = '{"uploadId":"upload-1"}';
      const signature = createQstashSignature('other-key', body);

      assert.equal(verifyQstashSignature(keys, { body, signature }), false);
    });

    it('rejects a valid signature when the body does not match', () => {
      const signature = createQstashSignature(keys.currentSigningKey, '{"uploadId":"upload-1"}');

      assert.equal(verifyQstashSignature(keys, { body: '{"uploadId":"tampered"}', signature }), false);
    });
  });
});
