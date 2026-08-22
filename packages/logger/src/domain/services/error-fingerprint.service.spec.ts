import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createErrorFingerprint } from './error-fingerprint.service.js';

describe('createErrorFingerprint', () => {
  it('deve agrupar erros pelo componente, evento e nome da classe', () => {
    assert.equal(
      createErrorFingerprint({ component: 'bff', event: 'request_failed', error: 'TypeError' }),
      'bff/request_failed/TypeError',
    );
  });

  it('deve colapsar mensagens livres no mesmo fingerprint', () => {
    assert.equal(
      createErrorFingerprint({ component: 'dataset-import-writer', event: 'consumer_connection_failed', error: 'connect ECONNREFUSED' }),
      'dataset-import-writer/consumer_connection_failed/Error',
    );
  });
});
