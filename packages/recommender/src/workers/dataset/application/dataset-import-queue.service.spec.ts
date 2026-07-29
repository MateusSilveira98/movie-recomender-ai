import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient } from '@libsql/client';
import { createDatasetImportQueue } from './dataset-import-queue.service.js';

describe('fila de importacao do dataset', () => {
  it('deve importar links sem aguardar filmes', async () => {
    const context = await createTestContext();

    try {
      const filePath = await createCsv(context.directory, 'links.csv', 'movieId,tmdbId\n1,10\n');
      const upload = await context.queue.enqueue({ fileName: 'links.csv', sizeBytes: 19, storagePath: filePath, type: 'links' });
      const completedUpload = await waitForUpload(context.queue, upload.id);

      assert.equal(completedUpload.status, 'success');
    } finally {
      await context.dispose();
    }
  });

  it('deve informar filmes como dependencia de creditos', async () => {
    const context = await createTestContext();

    try {
      const filePath = await createCsv(context.directory, 'credits.csv', 'id,cast,crew\n10,[],[]\n');
      const upload = await context.queue.enqueue({ fileName: 'credits.csv', sizeBytes: 24, storagePath: filePath, type: 'credits' });
      const waitingUpload = await waitForUpload(context.queue, upload.id);

      assert.deepEqual(waitingUpload.dependencies, [{ reason: 'O arquivo requer filmes cadastrados.', type: 'movies' }]);
    } finally {
      await context.dispose();
    }
  });
});

async function createTestContext() {
  const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-dataset-'));
  const client = createClient({ url: `file:${join(directory, 'database.db')}` });
  await client.executeMultiple(await readFile('packages/database/src/schema.sql', 'utf8'));
  const queue = createDatasetImportQueue(client);

  return {
    directory,
    dispose: async () => {
      await client.close();
      await rm(directory, { force: true, recursive: true });
    },
    queue,
  };
}

async function createCsv(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = join(directory, fileName);
  await writeFile(filePath, content);
  return filePath;
}

async function waitForUpload(queue: ReturnType<typeof createDatasetImportQueue>, uploadId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const upload = await queue.findUpload(uploadId);

    if (upload && upload.status !== 'queued' && upload.status !== 'processing') {
      return upload;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('O processamento do upload nao terminou no prazo esperado.');
}
