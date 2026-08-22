import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactLogEntry, selectExportableLogFields } from './log-entry-redaction.service.js';

describe('log entry redaction', () => {
  it('deve remover chaves sensíveis e mascarar token no valor', () => {
    const redacted = redactLogEntry({
      authorization: 'Bearer secret',
      component: 'bff',
      event: 'request_failed',
      path: '/health',
      token: 'xaat-11111111-2222-3333-4444-555555555555',
    });

    assert.deepEqual(redacted, { component: 'bff', event: 'request_failed', path: '/health' });
  });

  it('deve exportar somente o allowlist combinado', () => {
    const exported = selectExportableLogFields({
      chunkId: 'chunk-1',
      component: 'dataset-import-chunk',
      consumer: 'ratings',
      event: 'chunk_processing_failed',
      fingerprint: 'dataset-import-chunk/chunk_processing_failed/Error',
      jobId: 'job-1',
      path: '/internal',
    });

    assert.deepEqual(exported, {
      chunkId: 'chunk-1',
      component: 'dataset-import-chunk',
      event: 'chunk_processing_failed',
      fingerprint: 'dataset-import-chunk/chunk_processing_failed/Error',
      jobId: 'job-1',
    });
  });
});
