import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDatasetImportStatusStore } from './dataset-import-status.store.js';

describe('status durável de importação', () => {
  it('deve ignorar manifestos inválidos ao listar uploads', async () => {
    const objects = new Map<string, string>([
      ['dataset-imports/ok/status.json', JSON.stringify(status('ok'))],
      ['dataset-imports/invalido/status.json', '{'],
    ]);
    const store = createDatasetImportStatusStore(fakeClient(objects) as never, 'dataset-imports');

    assert.deepEqual(await store.list(), [status('ok')]);
  });
});

function status(id: string) {
  return { createdAt: '2026-08-12T12:00:00.000Z', errorMessage: null, fileName: 'ratings.csv', id, normalizedChunks: null, sizeBytes: 10, stage: 'accepted' as const, type: 'ratings' as const, updatedAt: '2026-08-12T12:00:00.000Z' };
}

function fakeClient(objects: Map<string, string>) {
  return {
    async send(command: { input: { Key?: string; Prefix?: string } }) {
      if ('Prefix' in command.input) {
        return { Contents: [...objects.keys()].filter((key) => key.startsWith(command.input.Prefix ?? '')).map((Key) => ({ Key })), IsTruncated: false };
      }
      const value = objects.get(command.input.Key ?? '');
      if (!value) throw { name: 'NoSuchKey' };
      return { Body: { transformToString: async () => value } };
    },
  };
}
