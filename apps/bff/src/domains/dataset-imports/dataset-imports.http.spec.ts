import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import type { DatasetImportQueue } from '@pkg/recommender';
import express from 'express';
import { createListDatasetImportDiagnosticsController } from './controllers/dataset-imports.controller.js';
import { requestErrorHandler } from '../../middlewares/request-logger.middleware.js';
import { createBffTestContext, request } from '../../test-support/bff-test-context.js';

describe('Dataset import diagnostics HTTP API', () => {
  describe('access control', () => {
    it('rejects dataset imports without a valid administrative token', async () => {
      const unavailableContext = await createBffTestContext({ datasetImportAdminToken: '' });
      const protectedContext = await createBffTestContext({ datasetImportAdminToken: 'admin-token' });
      try {
        assert.equal((await request(unavailableContext, '/dataset-uploads')).status, 503);
        assert.equal((await request(protectedContext, '/dataset-uploads')).status, 403);
        assert.equal((await request(protectedContext, '/dataset-uploads', { headers: { 'X-Dataset-Import-Token': 'admin-token' } })).status, 200);
      } finally { await unavailableContext.dispose(); await protectedContext.dispose(); }
    });
  });

  describe('diagnostic results', () => {
    it('returns paginated diagnostics and validates pagination parameters', async () => {
      const context = await createBffTestContext({ datasetImportAdminToken: 'admin-token' });
      try {
        await context.client.batch([uploadStatement(), jobStatement(), diagnosticStatement(), summaryStatement()], 'write');
        const headers = { 'X-Dataset-Import-Token': 'admin-token' };
        const response = await request(context, '/dataset-uploads/upload-with-errors/diagnostics?limit=1&offset=0', { headers });
        const body = await response.json() as { diagnostics: Array<{ field: string; fileName: string; lineStart: number }>; page: { detectedTotal: number; total: number; truncated: boolean }; summary: Array<{ category: string; count: number; field: string; reason: string; ruleCode: string }> };
        assert.equal(response.status, 200);
        assert.deepEqual(body.page, { detectedTotal: 1, limit: 1, offset: 0, total: 1, truncated: false });
        assert.deepEqual(body.diagnostics.map((diagnostic) => ({ field: diagnostic.field, fileName: diagnostic.fileName, lineStart: diagnostic.lineStart })), [{ field: 'tmdbId', fileName: 'links.csv', lineStart: 3 }]);
        assert.deepEqual(body.summary, [{ category: 'validation', count: 1, field: 'tmdbId', reason: 'invalid_field', ruleCode: 'positive_integer_required' }]);
        assert.equal((await request(context, '/dataset-uploads/upload-with-errors/diagnostics?limit=101', { headers })).status, 400);
        assert.equal((await request(context, '/dataset-uploads/missing/diagnostics', { headers })).status, 404);
      } finally { await context.dispose(); }
    });

    it('returns a JSON error when the diagnostics query fails', async () => {
      const app = express();
      const queue: DatasetImportQueue = { enqueue: async () => { throw new Error('Unused'); }, findUpload: async () => null, listDiagnostics: async () => { throw new Error('Database unavailable'); }, listJobs: async () => [], listUploads: async () => [], processPending: async () => undefined };
      app.get('/dataset-uploads/:uploadId/diagnostics', createListDatasetImportDiagnosticsController(queue));
      app.use(requestErrorHandler);
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}/dataset-uploads/failed/diagnostics`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: 'Nao foi possivel concluir a requisicao.' });
      } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))); }
    });
  });
});

function uploadStatement() { return { args: ['upload-with-errors', 'links.csv', 'links', 10, 'partial_error'], sql: 'INSERT INTO dataset_uploads (id, file_name, file_type, size_bytes, status) VALUES (?, ?, ?, ?, ?)' }; }
function jobStatement() { return { args: ['job-with-errors', 'upload-with-errors', 'links', 'completed'], sql: 'INSERT INTO dataset_import_jobs (id, upload_id, file_type, status) VALUES (?, ?, ?, ?)' }; }
function diagnosticStatement() { return { args: ['diagnostic-1', 'upload-with-errors', 3, 3, 'tmdbId', 'abc', 'validation', 'invalid_field', 'positive_integer_required', 'Field must be an integer.'], sql: 'INSERT INTO dataset_import_diagnostics (id, upload_id, line_start, line_end, field_name, value_preview, diagnostic_category, reason, rule_code, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' }; }
function summaryStatement() { return { args: ['upload-with-errors', 'validation', 'tmdbId', 'invalid_field', 'positive_integer_required', 1], sql: 'INSERT INTO dataset_import_diagnostic_summaries (upload_id, diagnostic_category, field_name, reason, rule_code, count) VALUES (?, ?, ?, ?, ?, ?)' }; }
