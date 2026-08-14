import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient } from '@libsql/client';
import { createDatasetUploadWithJob, failDatasetImportJob, findDatasetUpload, requeueInterruptedDatasetImportJobs } from './dataset-import-queue.repository.js';
import { createDatasetImportChunk, createDatasetImportChunks, listDatasetImportChunks, listQueuedDatasetImportChunks } from './dataset-import-chunks.repository.js';
import { reserveMovieKeys } from './dataset-import-movie-credit-chunk-records.repository.js';

describe('chunks de importação do dataset', () => {
  it('deve persistir checkpoints ordenados para o job-pai', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'ratings.csv', sizeBytes: 100, storagePath: '/tmp/ratings.csv', type: 'ratings',
      });
      const chunks = await createDatasetImportChunks(context.client, upload.jobId, [
        { contentHash: 'hash-0', lineEnd: 10_001, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 10_000, sequence: 0 },
        { contentHash: 'hash-1', lineEnd: 20_001, lineStart: 10_002, payloadPath: '/tmp/chunk-1.jsonl', recordCount: 10_000, sequence: 1 },
      ]);

      assert.deepEqual(chunks.map((chunk) => ({
        contentHash: chunk.contentHash, lineEnd: chunk.lineEnd, lineStart: chunk.lineStart, payloadPath: chunk.payloadPath,
        recordCount: chunk.recordCount, sequence: chunk.sequence, status: chunk.status,
      })), [
        { contentHash: 'hash-0', lineEnd: 10_001, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 10_000, sequence: 0, status: 'queued' },
        { contentHash: 'hash-1', lineEnd: 20_001, lineStart: 10_002, payloadPath: '/tmp/chunk-1.jsonl', recordCount: 10_000, sequence: 1, status: 'queued' },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it('deve manter o mesmo checkpoint ao retomar a criação dos chunks', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'ratings.csv', sizeBytes: 100, storagePath: '/tmp/ratings.csv', type: 'ratings',
      });
      const input = [{ contentHash: 'hash-0', lineEnd: 10_001, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 10_000, sequence: 0 }];

      await createDatasetImportChunks(context.client, upload.jobId, input);
      await createDatasetImportChunks(context.client, upload.jobId, input);

      assert.equal((await listDatasetImportChunks(context.client, upload.jobId)).length, 1);
    } finally {
      await context.dispose();
    }
  });

  it('deve impedir que a mesma sequência seja retomada com conteúdo diferente', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'ratings.csv', sizeBytes: 100, storagePath: '/tmp/ratings.csv', type: 'ratings',
      });
      await createDatasetImportChunks(context.client, upload.jobId, [
        { contentHash: 'hash-0', lineEnd: 10_001, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 10_000, sequence: 0 },
      ]);

      await assert.rejects(
        createDatasetImportChunks(context.client, upload.jobId, [
          { contentHash: 'outro-hash', lineEnd: 10_001, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 10_000, sequence: 0 },
        ]),
        /conteúdo diferente/,
      );
    } finally {
      await context.dispose();
    }
  });

  it('deve listar chunks enfileirados de jobs ativos para republicação', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'ratings.csv', sizeBytes: 100, storagePath: '/tmp/ratings.csv', type: 'ratings',
      });
      await createDatasetImportChunk(context.client, upload.jobId, {
        contentHash: 'hash-0', lineEnd: 2, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 1, sequence: 0,
      });

      const queued = await listQueuedDatasetImportChunks(context.client);

      assert.deepEqual(queued.map((chunk) => ({ jobId: chunk.jobId, type: chunk.type })), [{ jobId: upload.jobId, type: 'ratings' }]);
    } finally {
      await context.dispose();
    }
  });

  it('deve exibir ratings pendente de reconciliação como processamento', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'ratings.csv', sizeBytes: 100, storagePath: '/tmp/ratings.csv', type: 'ratings',
      });
      const chunk = await createDatasetImportChunk(context.client, upload.jobId, {
        contentHash: 'hash-0', lineEnd: 2, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 1, sequence: 0,
      });
      await context.client.batch([
        { sql: "UPDATE dataset_import_jobs SET status = 'completed' WHERE id = ?", args: [upload.jobId] },
        { sql: "UPDATE dataset_import_chunks SET status = 'completed', imported_rows = 1 WHERE id = ?", args: [chunk.id] },
        { sql: "UPDATE dataset_uploads SET status = 'partial_error', waiting_dependency_rows = 1 WHERE id = ?", args: [upload.id] },
      ], 'write');

      assert.equal((await findDatasetUpload(context.client, upload.id))?.status, 'processing');
    } finally {
      await context.dispose();
    }
  });

  it('deve finalizar os chunks pendentes quando o job falhar', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'movies.csv', sizeBytes: 100, storagePath: '/tmp/movies.csv', type: 'movies',
      });
      const chunks = await createDatasetImportChunks(context.client, upload.jobId, [
        { contentHash: 'hash-0', lineEnd: 2, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 1, sequence: 0 },
        { contentHash: 'hash-1', lineEnd: 3, lineStart: 3, payloadPath: '/tmp/chunk-1.jsonl', recordCount: 1, sequence: 1 },
      ]);
      await context.client.execute({ sql: "UPDATE dataset_import_chunks SET status = 'processing' WHERE id = ?", args: [chunks[0]!.id] });

      await failDatasetImportJob(context.client, { id: upload.jobId, uploadId: upload.id }, 'O chunk excedeu o limite de tentativas.', []);

      const persisted = await listDatasetImportChunks(context.client, upload.jobId);
      assert.deepEqual(persisted.map((chunk) => chunk.status), ['failed', 'failed']);
    } finally {
      await context.dispose();
    }
  });

  it('deve reencaminhar o chunk interrompido junto com o job-pai', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'ratings.csv', sizeBytes: 100, storagePath: '/tmp/ratings.csv', type: 'ratings',
      });
      const chunk = await createDatasetImportChunk(context.client, upload.jobId, {
        contentHash: 'hash-0', lineEnd: 2, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 1, sequence: 0,
      });
      await context.client.batch([
        { sql: "UPDATE dataset_import_jobs SET status = 'processing' WHERE id = ?", args: [upload.jobId] },
        { sql: "UPDATE dataset_import_chunks SET status = 'processing' WHERE id = ?", args: [chunk.id] },
      ], 'write');

      await requeueInterruptedDatasetImportJobs(context.client);

      assert.equal((await listDatasetImportChunks(context.client, upload.jobId))[0]?.status, 'queued');
    } finally {
      await context.dispose();
    }
  });

  it('deve reservar identidades de filmes em lote e desfazer inserções parciais em conflito', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'movies.csv', sizeBytes: 100, storagePath: '/tmp/movies.csv', type: 'movies',
      });
      const [first, second] = await createDatasetImportChunks(context.client, upload.jobId, [
        { contentHash: 'hash-0', lineEnd: 2, lineStart: 2, payloadPath: '/tmp/chunk-0.jsonl', recordCount: 1, sequence: 0 },
        { contentHash: 'hash-1', lineEnd: 3, lineStart: 3, payloadPath: '/tmp/chunk-1.jsonl', recordCount: 1, sequence: 1 },
      ]);
      const original = movie('1', 'tt0000001', 1);

      assert.deepEqual(await reserveMovieKeys(context.client, upload.id, first!.id, [original]), [true]);
      assert.deepEqual(await reserveMovieKeys(context.client, upload.id, second!.id, [movie('2', 'tt0000001', 2)]), [false]);

      const keys = await context.client.execute({ sql: 'SELECT key_type, key_value, movie_id FROM dataset_import_movie_keys WHERE upload_id = ? ORDER BY key_type', args: [upload.id] });
      assert.deepEqual(keys.rows.map((row) => [row.key_type, row.key_value, row.movie_id]), [
        ['imdb_id', 'tt0000001', '1'],
        ['movie_id', '1', '1'],
        ['movie_lens_id', '1', '1'],
      ]);
    } finally {
      await context.dispose();
    }
  });
});

function movie(id: string, imdbId: string, movieLensId: number) {
  return {
    adult: 0, backdropPath: null, belongsToCollectionJson: '{}', genres: [], homepage: '', id, imdbId, movieLensId,
    originalLanguage: 'en', originalTitle: id, overview: '', popularity: 0, posterPath: null, releaseDate: null,
    releaseYear: 0, runtimeMinutes: 0, status: '', tagline: '', title: id, tmdbId: id, voteAverage: 0, voteCount: 0,
  };
}

async function createTestContext() {
  const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-chunks-'));
  const client = createClient({ url: `file:${join(directory, 'database.db')}` });
  await client.executeMultiple(await readFile('packages/database/src/schema.sql', 'utf8'));

  return {
    client,
    dispose: async () => {
      await client.close();
      await rm(directory, { force: true, recursive: true });
    },
  };
}
