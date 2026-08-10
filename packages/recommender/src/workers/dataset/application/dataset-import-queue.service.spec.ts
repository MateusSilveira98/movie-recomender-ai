import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient } from '@libsql/client';
import { createDatasetImportQueue } from './dataset-import-queue.service.js';
import { createDatasetImportDiagnosticsCollector, MAX_PERSISTED_DIAGNOSTICS } from '../infrastructure/persistence/dataset-import-diagnostics.repository.js';
import { createDatasetUploadWithJob } from '../infrastructure/persistence/dataset-import-queue.repository.js';

describe('fila de importacao do dataset', () => {
  it('deve importar links sem aguardar filmes', async () => {
    const context = await createTestContext();

    try {
      const content = 'movieId,imdbId,tmdbId\n1,0114709,10\n';
      const filePath = await createCsv(context.directory, 'links.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'links.csv', sizeBytes: content.length, storagePath: filePath, type: 'links' });
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

  it('deve reprocessar upload interrompido ao iniciar a fila', async () => {
    const context = await createTestContext();

    try {
      const content = 'movieId,imdbId,tmdbId\n1,0114709,10\n';
      const filePath = await createCsv(context.directory, 'links.csv', content);
      const upload = await createDatasetUploadWithJob(context.client, { fileName: 'links.csv', sizeBytes: content.length, storagePath: filePath, type: 'links' });
      await context.client.batch([
        { sql: "UPDATE dataset_import_jobs SET status = 'processing' WHERE id = ?", args: [upload.jobId] },
        { sql: "UPDATE dataset_uploads SET status = 'processing' WHERE id = ?", args: [upload.id] },
      ], 'write');
      const recoveredQueue = createDatasetImportQueue(context.client);

      await recoveredQueue.processPending();

      const completedUpload = await recoveredQueue.findUpload(upload.id);
      assert.equal(completedUpload?.status, 'success');
    } finally {
      await context.dispose();
    }
  });

  it('deve falhar antes de escrever quando o CSV possui uma linha estruturalmente inválida', async () => {
    const context = await createTestContext();

    try {
      const content = 'movieId,imdbId,tmdbId\n1,0114709,10\n2,0114710,20,extra\n';
      const filePath = await createCsv(context.directory, 'links.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'links.csv', sizeBytes: content.length, storagePath: filePath, type: 'links' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const page = await context.queue.listDiagnostics(upload.id, { limit: 50, offset: 0 });
      const links = await context.client.execute('SELECT COUNT(*) AS count FROM dataset_movie_links');

      assert.equal(completedUpload.status, 'error');
      assert.equal(completedUpload.summary.imported, 0);
      assert.equal(links.rows[0]?.count, 0);
      assert.deepEqual(page?.diagnostics.map((diagnostic) => ({ field: diagnostic.field, lineStart: diagnostic.lineStart, ruleCode: diagnostic.ruleCode })), [
        { field: null, lineStart: 3, ruleCode: 'invalid_column_count' },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it('deve falhar antes de escrever quando o cabeçalho não segue o contrato', async () => {
    const context = await createTestContext();

    try {
      const content = 'movieId,tmdbId\n1,10\n';
      const filePath = await createCsv(context.directory, 'links.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'links.csv', sizeBytes: content.length, storagePath: filePath, type: 'links' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const page = await context.queue.listDiagnostics(upload.id, { limit: 50, offset: 0 });
      const links = await context.client.execute('SELECT COUNT(*) AS count FROM dataset_movie_links');

      assert.equal(completedUpload.status, 'error');
      assert.equal(links.rows[0]?.count, 0);
      assert.deepEqual(page?.diagnostics.map((diagnostic) => ({ field: diagnostic.field, lineStart: diagnostic.lineStart, ruleCode: diagnostic.ruleCode })), [
        { field: 'imdbId', lineStart: 1, ruleCode: 'required_header' },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it('deve falhar antes de escrever quando o arquivo não usa UTF-8 válido', async () => {
    const context = await createTestContext();

    try {
      const filePath = join(context.directory, 'links.csv');
      const content = Buffer.from([0xc3, 0x28]);
      await writeFile(filePath, content);
      const upload = await context.queue.enqueue({ fileName: 'links.csv', sizeBytes: content.length, storagePath: filePath, type: 'links' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const page = await context.queue.listDiagnostics(upload.id, { limit: 50, offset: 0 });
      const links = await context.client.execute('SELECT COUNT(*) AS count FROM dataset_movie_links');

      assert.equal(completedUpload.status, 'error');
      assert.equal(links.rows[0]?.count, 0);
      assert.deepEqual(page?.diagnostics.map((diagnostic) => ({ field: diagnostic.field, ruleCode: diagnostic.ruleCode })), [
        { field: null, ruleCode: 'utf8_encoding' },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it('deve importar linhas válidas e expor o erro detalhado da linha inválida', async () => {
    const context = await createTestContext();

    try {
      const content = 'movieId,imdbId,tmdbId\n1,0114709,10\n2,0114710,\n';
      const filePath = await createCsv(context.directory, 'links.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'links.csv', sizeBytes: content.length, storagePath: filePath, type: 'links' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const page = await context.queue.listDiagnostics(upload.id, { limit: 50, offset: 0 });
      const links = await context.client.execute('SELECT COUNT(*) AS count FROM dataset_movie_links');

      assert.equal(completedUpload.status, 'partial_error');
      assert.deepEqual(completedUpload.summary, { imported: 1, processed: 2, rejected: 1, waitingDependencies: 0 });
      assert.equal(links.rows[0]?.count, 1);
      assert.deepEqual(page?.diagnostics.map((diagnostic) => ({ field: diagnostic.field, lineStart: diagnostic.lineStart, reason: diagnostic.reason, ruleCode: diagnostic.ruleCode })), [
        { field: 'tmdbId', lineStart: 3, reason: 'invalid_field', ruleCode: 'required' },
      ]);
      assert.equal(page?.page.total, 1);
    } finally {
      await context.dispose();
    }
  });

  it('deve separar referências ausentes de valores inválidos', async () => {
    const context = await createTestContext();

    try {
      await seedMovie(context.client, '10');
      const content = 'id,cast,crew\n10,[],[]\n999,[],[]\n';
      const filePath = await createCsv(context.directory, 'credits.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'credits.csv', sizeBytes: content.length, storagePath: filePath, type: 'credits' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const page = await context.queue.listDiagnostics(upload.id, { limit: 50, offset: 0 });

      assert.equal(completedUpload.status, 'partial_error');
      assert.deepEqual(completedUpload.summary, { imported: 1, processed: 2, rejected: 0, waitingDependencies: 1 });
      assert.deepEqual(page?.diagnostics.map((diagnostic) => ({ field: diagnostic.field, reason: diagnostic.reason, ruleCode: diagnostic.ruleCode })), [
        { field: 'id', reason: 'movie_not_found', ruleCode: 'movie_reference' },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it('deve substituir os gêneros antigos do filme aceito', async () => {
    const context = await createTestContext();

    try {
      await seedMovie(context.client, '10');
      await context.client.execute({
        sql: 'INSERT INTO movie_genres (movie_id, genre_id, genre_name, genre_order) VALUES (?, ?, ?, ?)',
        args: ['10', 1, 'Antigo', 0],
      });
      const content = 'adult,belongs_to_collection,budget,genres,homepage,id,imdb_id,original_language,original_title,overview,popularity,poster_path,production_companies,production_countries,release_date,revenue,runtime,spoken_languages,status,tagline,title,video,vote_average,vote_count\n' +
        'False,,0,"[{""id"":2,""name"":""Novo""}]",,10,,pt,Título,,0,,[],[],2024-01-01,0,90,[],Released,,Título,False,0,0\n';
      const filePath = await createCsv(context.directory, 'movies.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'movies.csv', sizeBytes: content.length, storagePath: filePath, type: 'movies' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const genres = await context.client.execute({
        sql: 'SELECT genre_id, genre_name FROM movie_genres WHERE movie_id = ? ORDER BY genre_order',
        args: ['10'],
      });

      assert.equal(completedUpload.status, 'success');
      assert.deepEqual(genres.rows.map((genre) => ({ id: genre.genre_id, name: genre.genre_name })), [{ id: 2, name: 'Novo' }]);
    } finally {
      await context.dispose();
    }
  });

  it('deve substituir elenco e equipe antigos do filme aceito', async () => {
    const context = await createTestContext();

    try {
      await seedMovie(context.client, '10');
      await context.client.batch([
        {
          sql: 'INSERT INTO movie_cast (movie_id, credit_id, cast_order, person_id, person_name) VALUES (?, ?, ?, ?, ?)',
          args: ['10', 'cast-antigo', 0, 1, 'Pessoa antiga'],
        },
        {
          sql: 'INSERT INTO movie_crew (movie_id, credit_id, person_id, person_name, department, job) VALUES (?, ?, ?, ?, ?, ?)',
          args: ['10', 'crew-antigo', 2, 'Equipe antiga', 'Production', 'Producer'],
        },
      ], 'write');
      const content = 'id,cast,crew\n10,[],[]\n';
      const filePath = await createCsv(context.directory, 'credits.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'credits.csv', sizeBytes: content.length, storagePath: filePath, type: 'credits' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const [cast, crew] = await Promise.all([
        context.client.execute({ sql: 'SELECT COUNT(*) AS count FROM movie_cast WHERE movie_id = ?', args: ['10'] }),
        context.client.execute({ sql: 'SELECT COUNT(*) AS count FROM movie_crew WHERE movie_id = ?', args: ['10'] }),
      ]);

      assert.equal(completedUpload.status, 'success');
      assert.equal(cast.rows[0]?.count, 0);
      assert.equal(crew.rows[0]?.count, 0);
    } finally {
      await context.dispose();
    }
  });

  it('deve rejeitar vínculo que conflita com a relação já persistida no filme', async () => {
    const context = await createTestContext();

    try {
      await seedMovie(context.client, '10');
      await context.client.execute({ sql: 'UPDATE movies SET movie_lens_id = ? WHERE id = ?', args: [9, '10'] });
      const content = 'movieId,imdbId,tmdbId\n1,0114709,10\n';
      const filePath = await createCsv(context.directory, 'links.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'links.csv', sizeBytes: content.length, storagePath: filePath, type: 'links' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const page = await context.queue.listDiagnostics(upload.id, { limit: 50, offset: 0 });
      const links = await context.client.execute('SELECT COUNT(*) AS count FROM dataset_movie_links');

      assert.equal(completedUpload.status, 'error');
      assert.equal(links.rows[0]?.count, 0);
      assert.equal(page?.diagnostics[0]?.ruleCode, 'conflicting_tmdb_mapping');
    } finally {
      await context.dispose();
    }
  });

  it('deve rejeitar linhas repetidas de créditos para o mesmo filme', async () => {
    const context = await createTestContext();

    try {
      await seedMovie(context.client, '10');
      const content = 'id,cast,crew\n10,[],[]\n10,[],[]\n';
      const filePath = await createCsv(context.directory, 'credits.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'credits.csv', sizeBytes: content.length, storagePath: filePath, type: 'credits' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const page = await context.queue.listDiagnostics(upload.id, { limit: 50, offset: 0 });

      assert.equal(completedUpload.status, 'partial_error');
      assert.deepEqual(completedUpload.summary, { imported: 1, processed: 2, rejected: 1, waitingDependencies: 0 });
      assert.equal(page?.diagnostics[0]?.ruleCode, 'duplicate_movie_credits');
    } finally {
      await context.dispose();
    }
  });

  it('deve paginar diagnósticos e mascarar identificadores de usuários', async () => {
    const context = await createTestContext();

    try {
      await seedMovie(context.client, '10');
      await context.client.execute({
        sql: `INSERT INTO dataset_movie_links (movie_lens_id, tmdb_id) VALUES (?, ?)`,
        args: [1, '10'],
      });
      const content = 'userId,movieId,rating,timestamp\ninvalido,1,5,100\n2,1,6,101\n';
      const filePath = await createCsv(context.directory, 'ratings.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'ratings.csv', sizeBytes: content.length, storagePath: filePath, type: 'ratings' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const firstPage = await context.queue.listDiagnostics(upload.id, { limit: 1, offset: 0 });
      const secondPage = await context.queue.listDiagnostics(upload.id, { limit: 1, offset: 1 });

      assert.equal(completedUpload.status, 'error');
      assert.equal(firstPage?.page.total, 2);
      assert.equal(firstPage?.diagnostics[0]?.field, 'userId');
      assert.equal(firstPage?.diagnostics[0]?.value, '[mascarado]');
      assert.equal(secondPage?.diagnostics[0]?.field, 'rating');
    } finally {
      await context.dispose();
    }
  });

  it('deve impedir avaliações duplicadas de enviesarem as estatísticas', async () => {
    const context = await createTestContext();

    try {
      await seedMovie(context.client, '10');
      await context.client.execute({
        sql: `INSERT INTO dataset_movie_links (movie_lens_id, tmdb_id) VALUES (?, ?)`,
        args: [1, '10'],
      });
      const content = 'userId,movieId,rating,timestamp\n2,1,4,100\n2,1,5,101\n';
      const filePath = await createCsv(context.directory, 'ratings.csv', content);
      const upload = await context.queue.enqueue({ fileName: 'ratings.csv', sizeBytes: content.length, storagePath: filePath, type: 'ratings' });
      const completedUpload = await waitForUpload(context.queue, upload.id);
      const page = await context.queue.listDiagnostics(upload.id, { limit: 50, offset: 0 });
      const stats = await context.client.execute({ sql: 'SELECT rating_count, rating_average FROM movie_ratings_stats WHERE movie_id = ?', args: ['10'] });
      const transientKeys = await context.client.execute('SELECT COUNT(*) AS count FROM dataset_import_rating_keys');

      assert.equal(completedUpload.status, 'partial_error');
      assert.deepEqual(completedUpload.summary, { imported: 1, processed: 2, rejected: 1, waitingDependencies: 0 });
      assert.equal(stats.rows[0]?.rating_count, 1);
      assert.equal(stats.rows[0]?.rating_average, 4);
      assert.equal(page?.diagnostics[0]?.ruleCode, 'duplicate_user_movie_rating');
      assert.equal(transientKeys.rows[0]?.count, 0);
    } finally {
      await context.dispose();
    }
  });

  it('deve limitar detalhes sem perder o resumo completo dos diagnósticos', async () => {
    const context = await createTestContext();

    try {
      const upload = await createDatasetUploadWithJob(context.client, {
        fileName: 'links.csv',
        sizeBytes: 0,
        storagePath: join(context.directory, 'links.csv'),
        type: 'links',
      });
      const diagnostics = createDatasetImportDiagnosticsCollector(context.client, upload.id);

      for (let index = 0; index < MAX_PERSISTED_DIAGNOSTICS + 2; index += 1) {
        await diagnostics.record({
          category: 'validation',
          field: 'homepage',
          lineEnd: index + 2,
          lineStart: index + 2,
          message: 'A URL e invalida.',
          reason: 'invalid_field',
          ruleCode: 'http_url',
          value: 'conteudo que nao deve ser exposto',
        });
      }

      await diagnostics.flush();
      const page = await context.queue.listDiagnostics(upload.id, { limit: 1, offset: 0 });

      assert.equal(page?.page.total, MAX_PERSISTED_DIAGNOSTICS);
      assert.equal(page?.page.detectedTotal, MAX_PERSISTED_DIAGNOSTICS + 2);
      assert.equal(page?.page.truncated, true);
      assert.equal(page?.diagnostics[0]?.value, '[mascarado]');
      assert.deepEqual(page?.summary, [{
        category: 'validation',
        count: MAX_PERSISTED_DIAGNOSTICS + 2,
        field: 'homepage',
        reason: 'invalid_field',
        ruleCode: 'http_url',
      }]);
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
    client,
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

async function seedMovie(client: ReturnType<typeof createClient>, id: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO movies (id, tmdb_id, title, original_title, release_year, runtime_minutes, popularity, vote_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, id, 'Filme de teste', 'Filme de teste', 2024, 100, 1, 1],
  });
}

async function waitForUpload(queue: ReturnType<typeof createDatasetImportQueue>, uploadId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const upload = await queue.findUpload(uploadId);

    if (upload && upload.status !== 'queued' && upload.status !== 'processing') {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return upload;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('O processamento do upload nao terminou no prazo esperado.');
}
