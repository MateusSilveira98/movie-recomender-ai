import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectExportableLogFields } from '../consts/exportable-log-fields.const.js';
import { redactLogEntry } from './log-entry-redaction.service.js';

describe('log entry redaction', () => {
  it('deve remover chaves sensíveis e mascarar token no valor', () => {
    const redacted = redactLogEntry({
      authorization: 'Bearer secret-token',
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

  it('deve preservar o stack do erro além do limite de texto comum', () => {
    const errorStack = `Error: SQLITE_IOERR\n${'    at frame (/app/file.js:1:1)\n'.repeat(60)}`;

    const redacted = redactLogEntry({ component: 'dataset-import-queue', errorStack, event: 'job_failed' });

    assert.equal(redacted.errorStack, errorStack.slice(0, 4000));
    assert.ok(String(redacted.errorStack).length > 200);
  });

  it('deve truncar textos comuns no limite de 200 caracteres', () => {
    const redacted = redactLogEntry({ component: 'bff', event: 'request_failed', path: 'a'.repeat(500) });

    assert.equal(String(redacted.path).length, 200);
  });

  it('deve exportar os campos de diagnóstico de falhas para o Axiom', () => {
    const exported = selectExportableLogFields({
      attemptCount: 2,
      component: 'dataset-import-queue',
      errorCode: 'SQLITE_IOERR',
      errorMessage: 'SQLITE_IOERR: disk I/O error',
      event: 'job_failed',
      fileType: 'credits',
      rawCode: 1034,
      timestamp: '2026-10-28T12:00:00.000Z',
    });

    assert.deepEqual(exported, {
      attemptCount: 2,
      component: 'dataset-import-queue',
      errorCode: 'SQLITE_IOERR',
      errorMessage: 'SQLITE_IOERR: disk I/O error',
      event: 'job_failed',
      fileType: 'credits',
      rawCode: 1034,
      timestamp: '2026-10-28T12:00:00.000Z',
    });
  });

  it('deve redigir credencial em URL de conexão sem remover paginação', () => {
    const redacted = redactLogEntry({
      component: 'dataset-import-queue',
      errorMessage: 'falha em libsql://db.example.io?authToken=abc123 e https://user:hunter2@host.example/x',
      event: 'job_failed',
      path: '/sessions?page=2&limit=10',
    });

    assert.equal(redacted.errorMessage, '[redacted]');
    assert.equal(redacted.path, '/sessions?page=2&limit=10');
  });
});
