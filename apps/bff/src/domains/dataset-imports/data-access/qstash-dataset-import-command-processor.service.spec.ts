import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { DatasetImportQueue } from '@pkg/recommender';
import { createQstashDatasetImportCommandProcessor } from './qstash-dataset-import-command-processor.service.js';

const command = {
  fileName: 'ratings.csv',
  objectKey: 'dataset-imports/upload-1/ratings.csv',
  sizeBytes: 7,
  type: 'ratings' as const,
  uploadId: 'upload-1',
};

describe('QStash dataset import command processor', () => {
  it('downloads the upload and processes it with the original upload identifier', async () => {
    const enqueued: unknown[] = [];
    let processed = 0;
    const queue = {
      enqueue: async (upload: unknown) => { enqueued.push(upload); return {} as never; },
      processPending: async () => { processed += 1; },
    } as unknown as DatasetImportQueue;
    const processor = createQstashDatasetImportCommandProcessor(queue, {
      download: async (_command, destination) => { await writeFile(destination, 'payload'); },
      upload: async () => undefined,
    });

    try {
      await processor(command);

      assert.equal(processed, 1);
      assert.equal(enqueued.length, 1);
      const upload = enqueued[0] as { storagePath: string; uploadId: string };
      assert.equal(upload.uploadId, command.uploadId);
      assert.equal(await readFile(upload.storagePath, 'utf8'), 'payload');
    } finally {
      await rm(join(tmpdir(), 'movie-recommender-qstash-imports', command.uploadId), { force: true, recursive: true });
    }
  });

  it('uploads a local file to R2 and enqueues without downloading', async () => {
    const enqueued: unknown[] = [];
    let processed = 0;
    let downloaded = false;
    let uploaded = false;
    const queue = {
      enqueue: async (upload: unknown) => { enqueued.push(upload); return {} as never; },
      processPending: async () => { processed += 1; },
    } as unknown as DatasetImportQueue;
    const localFilePath = join(tmpdir(), 'movie-recommender-test-local', 'ratings.csv');
    await mkdir(join(localFilePath, '..'), { recursive: true });
    await writeFile(localFilePath, 'payload');
    const processor = createQstashDatasetImportCommandProcessor(queue, {
      download: async () => { downloaded = true; },
      upload: async () => { uploaded = true; },
    });

    try {
      await processor({ ...command, localFilePath });

      assert.equal(uploaded, true, 'should upload local file to R2');
      assert.equal(downloaded, false, 'should not download from R2 when local file exists');
      assert.equal(processed, 1);
      assert.equal(enqueued.length, 1);
      const upload = enqueued[0] as { storagePath: string; uploadId: string };
      assert.equal(upload.uploadId, command.uploadId);
      assert.equal(upload.storagePath, localFilePath);
    } finally {
      await rm(join(tmpdir(), 'movie-recommender-test-local'), { force: true, recursive: true });
    }
  });

  it('rejects a downloaded object with a different size before queuing it', async () => {
    let enqueued = false;
    const queue = {
      enqueue: async () => { enqueued = true; return {} as never; },
      processPending: async () => undefined,
    } as unknown as DatasetImportQueue;
    const processor = createQstashDatasetImportCommandProcessor(queue, {
      download: async (_command, destination) => { await writeFile(destination, 'too small'); },
      upload: async () => undefined,
    });

    try {
      await assert.rejects(() => processor(command), { message: 'O tamanho do arquivo baixado não corresponde ao upload aceito.' });
      assert.equal(enqueued, false);
    } finally {
      await rm(join(tmpdir(), 'movie-recommender-qstash-imports', command.uploadId), { force: true, recursive: true });
    }
  });
});
