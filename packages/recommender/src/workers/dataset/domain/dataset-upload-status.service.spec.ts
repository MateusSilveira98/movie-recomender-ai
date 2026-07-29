import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDatasetUploadStatus } from './dataset-upload-status.service.js';

describe('status do upload de dataset', () => {
  it('deve retornar sucesso quando todas as linhas forem importadas', () => {
    const status = resolveDatasetUploadStatus({ dependencies: [], failures: [], summary: { imported: 2, processed: 2, rejected: 0, waitingDependencies: 0 } });

    assert.equal(status, 'success');
  });

  it('deve retornar erro parcial quando parte das linhas falhar', () => {
    const status = resolveDatasetUploadStatus({
      dependencies: [],
      failures: [{ count: 1, message: 'Linha invalida.', reason: 'invalid_row' }],
      summary: { imported: 1, processed: 2, rejected: 1, waitingDependencies: 0 },
    });

    assert.equal(status, 'partial_error');
  });

  it('deve retornar erro quando nenhuma linha puder ser importada', () => {
    const status = resolveDatasetUploadStatus({
      dependencies: [],
      failures: [{ count: 2, message: 'Linhas invalidas.', reason: 'invalid_row' }],
      summary: { imported: 0, processed: 2, rejected: 2, waitingDependencies: 0 },
    });

    assert.equal(status, 'error');
  });
});
