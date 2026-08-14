import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client';

const executeFile = promisify(execFile);
const composeArguments = ['compose', '--project-name', 'movie-recommender-import-integration', '--env-file', '.env', '-f', 'docker-compose.yml', '-f', 'docker-compose.integration.yml'];
const baseUrl = 'http://127.0.0.1:4333';
const databaseUrl = 'http://127.0.0.1:28080';
const recordsPerFile = 201;
const timeoutAt = Date.now() + 360_000;
const lockPath = join(tmpdir(), 'movie-recommender-import-integration.lock');

process.loadEnvFile('.env');

const importToken = requiredImportToken();

await acquireLock();

try {
  await runCompose('down', '--volumes', '--remove-orphans').catch(() => undefined);
  await runCompose('up', '--detach', 'database', 'minio', 'rabbitmq');
  await runMigration();
  await runCompose('run', '--rm', 'minio-init');
  await runCompose('up', '--detach', '--no-deps', 'bff', 'dataset-import-reader', 'dataset-import-writer');
  await waitForBff();

  const uploads = await Promise.all([
    uploadCsv('movies', 'movies.csv', moviesCsv()),
    uploadCsv('links', 'links.csv', linksCsv()),
    uploadCsv('credits', 'credits.csv', creditsCsv()),
    uploadCsv('ratings', 'ratings.csv', ratingsCsv()),
  ]);

  await waitForTerminalUploads(uploads);
  await assertDatabaseState();
  await assertReconciliationWithinDeadline();
  await assertExpiredStagingIsPurged();
  await assertQueuesAreDrained();
  await assertWorkerHasNoLocks();
} finally {
  await runCompose('down', '--volumes', '--remove-orphans').catch(() => undefined);
  await rm(lockPath, { force: true, recursive: true });
}

function moviesCsv(): string {
  const header = 'adult,belongs_to_collection,budget,genres,homepage,id,imdb_id,original_language,original_title,overview,popularity,poster_path,production_companies,production_countries,release_date,revenue,runtime,spoken_languages,status,tagline,title,video,vote_average,vote_count';
  const rows = Array.from({ length: recordsPerFile }, (_, index) => {
    const id = index + 1;
    return `False,,0,"[{""id"":1,""name"":""Teste""}]",,${id},,pt,Filme ${id},Resumo ${id},0,,[],[],2024-01-01,0,90,[],Released,,Filme ${id},False,0,0`;
  });
  return [header, ...rows].join('\n');
}

function linksCsv(): string {
  const rows = Array.from({ length: recordsPerFile }, (_, index) => {
    const id = index + 1;
    return `${id},${String(id).padStart(7, '0')},${id}`;
  });
  return ['movieId,imdbId,tmdbId', ...rows].join('\n');
}

function creditsCsv(): string {
  const rows = Array.from({ length: recordsPerFile }, (_, index) => {
    const id = index + 1;
    return `${id},[],[]`;
  });
  return ['id,cast,crew', ...rows].join('\n');
}

function ratingsCsv(): string {
  const rows = Array.from({ length: recordsPerFile }, (_, index) => {
    const id = index + 1;
    return `1,${id},4,${1_700_000_000 + id}`;
  });
  return ['userId,movieId,rating,timestamp', ...rows].join('\n');
}

function movieCsv(id: number): string {
  return `${moviesCsvHeader()}\n${movieCsvRow(id)}`;
}

function creditsCsvForMovie(id: number): string {
  return `id,cast,crew\n${id},[],[]`;
}

function moviesCsvHeader(): string {
  return 'adult,belongs_to_collection,budget,genres,homepage,id,imdb_id,original_language,original_title,overview,popularity,poster_path,production_companies,production_countries,release_date,revenue,runtime,spoken_languages,status,tagline,title,video,vote_average,vote_count';
}

function movieCsvRow(id: number): string {
  return `False,,0,[],,${id},,pt,Filme ${id},Resumo ${id},0,,[],[],2024-01-01,0,90,[],Released,,Filme ${id},False,0,0`;
}

async function uploadCsv(type: 'movies' | 'links' | 'credits' | 'ratings', name: string, content: string): Promise<string> {
  const form = new FormData();
  form.set('type', type);
  form.set('file', new Blob([content], { type: 'text/csv' }), name);
  const response = await fetch(`${baseUrl}/dataset-uploads`, { body: form, headers: { 'x-dataset-import-token': importToken }, method: 'POST' });
  assert.equal(response.status, 202, `Upload ${type} não foi aceito.`);
  const body = await response.json() as { upload: { id: string } };
  return body.upload.id;
}

async function waitForBff(): Promise<void> {
  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // O BFF ainda está iniciando.
    }
    await delay(500);
  }
  throw new Error('O BFF não ficou disponível para o teste de integração.');
}

async function waitForTerminalUploads(uploadIds: readonly string[]): Promise<void> {
  while (Date.now() < timeoutAt) {
    const uploads = await Promise.all(uploadIds.map(async (id) => {
      const response = await fetch(`${baseUrl}/dataset-uploads/${id}`, { headers: { 'x-dataset-import-token': importToken } });
      assert.ok([200, 404].includes(response.status), `Falha ao consultar upload ${id}.`);
      return response.status === 404 ? { status: 'accepted' } : (await response.json() as { upload: { status: string } }).upload;
    }));
    if (uploads.every((upload) => ['success', 'partial_error', 'error'].includes(upload.status))) {
      assert.equal(uploads.some((upload) => upload.status === 'error'), false, 'Um upload concorrente falhou.');
      return;
    }
    await delay(1_000);
  }
  throw new Error('Os uploads concorrentes não chegaram a um estado terminal.');
}

async function waitForTerminalUpload(uploadId: string, expectedStatus: string): Promise<{ summary: { waitingDependencies: number } }> {
  while (Date.now() < timeoutAt) {
    const response = await fetch(`${baseUrl}/dataset-uploads/${uploadId}`, { headers: { 'x-dataset-import-token': importToken } });
    assert.ok([200, 404].includes(response.status), `Falha ao consultar upload ${uploadId}.`);
    if (response.status === 404) {
      await delay(500);
      continue;
    }
    const upload = (await response.json() as { upload: { status: string; summary: { waitingDependencies: number } } }).upload;
    if (['success', 'partial_error', 'error'].includes(upload.status)) {
      assert.equal(upload.status, expectedStatus);
      return upload;
    }
    await delay(500);
  }
  throw new Error(`Upload ${uploadId} não chegou ao status ${expectedStatus}.`);
}

async function assertReconciliationWithinDeadline(): Promise<void> {
  const pendingUpload = await uploadCsv('credits', 'credits-within-deadline.csv', creditsCsvForMovie(90_001));
  const pending = await waitForTerminalUpload(pendingUpload, 'partial_error');
  assert.equal(pending.summary.waitingDependencies, 1);

  const movieUpload = await uploadCsv('movies', 'movie-within-deadline.csv', movieCsv(90_001));
  await waitForTerminalUpload(movieUpload, 'success');

  await waitForUploadSummary(pendingUpload, 0);
}

async function assertExpiredStagingIsPurged(): Promise<void> {
  const expiredUpload = await uploadCsv('credits', 'credits-expired.csv', creditsCsvForMovie(90_002));
  const pending = await waitForTerminalUpload(expiredUpload, 'partial_error');
  assert.equal(pending.summary.waitingDependencies, 1);

  const client = createClient({ url: databaseUrl });
  try {
    const beforeExpiration = await client.execute({
      sql: `SELECT COUNT(*) AS chunks FROM dataset_import_chunks chunks
        JOIN dataset_import_jobs jobs ON jobs.id = chunks.job_id
        WHERE jobs.upload_id = ?`,
      args: [expiredUpload],
    });
    assert.ok(Number(beforeExpiration.rows[0]?.chunks) > 0);
    await client.execute({
      sql: "UPDATE dataset_uploads SET completed_at = datetime('now', '-3 days', '-1 second') WHERE id = ?",
      args: [expiredUpload],
    });

    const purged = await waitForExpiredUploadPurge(client, expiredUpload);
    assert.equal(purged.status, 'partial_error');
    assert.equal(purged.waitingDependencies, 0);
    assert.equal(purged.chunks, 0);

    await delay(1_500);
    const repeated = await readExpiredUploadState(client, expiredUpload);
    assert.deepEqual(repeated, purged);
  } finally {
    client.close();
  }
}

async function waitForUploadSummary(uploadId: string, waitingDependencies: number): Promise<void> {
  while (Date.now() < timeoutAt) {
    const upload = await waitForTerminalUpload(uploadId, 'partial_error');
    if (upload.summary.waitingDependencies === waitingDependencies) return;
    await delay(500);
  }
  throw new Error(`Upload ${uploadId} não teve as pendências reduzidas para ${waitingDependencies}.`);
}

async function waitForExpiredUploadPurge(client: ReturnType<typeof createClient>, uploadId: string): Promise<ExpiredUploadState> {
  while (Date.now() < timeoutAt) {
    const state = await readExpiredUploadState(client, uploadId);
    if (state.chunks === 0 && state.waitingDependencies === 0) return state;
    await delay(500);
  }
  throw new Error(`O staging expirado do upload ${uploadId} não foi removido.`);
}

type ExpiredUploadState = {
  chunks: number;
  status: string;
  waitingDependencies: number;
};

async function readExpiredUploadState(client: ReturnType<typeof createClient>, uploadId: string): Promise<ExpiredUploadState> {
  const result = await client.execute({
    sql: `SELECT uploads.status, uploads.waiting_dependency_rows, COUNT(chunks.id) AS chunks
      FROM dataset_uploads uploads
      LEFT JOIN dataset_import_jobs jobs ON jobs.upload_id = uploads.id
      LEFT JOIN dataset_import_chunks chunks ON chunks.job_id = jobs.id
      WHERE uploads.id = ?
      GROUP BY uploads.id`,
    args: [uploadId],
  });
  const row = result.rows[0];
  assert.ok(row, `Upload ${uploadId} não encontrado no banco.`);
  return {
    chunks: Number(row.chunks),
    status: String(row.status),
    waitingDependencies: Number(row.waiting_dependency_rows),
  };
}

async function assertDatabaseState(): Promise<void> {
  const client = createClient({ url: databaseUrl });
  try {
    const [movies, links, ratings, nonCompletedChunks] = await Promise.all([
      client.execute('SELECT COUNT(*) AS count FROM movies'),
      client.execute('SELECT COUNT(*) AS count FROM dataset_movie_links'),
      client.execute('SELECT COUNT(*) AS count FROM movie_ratings_stats'),
      client.execute("SELECT COUNT(*) AS count FROM dataset_import_chunks WHERE status <> 'completed'"),
    ]);
    assert.equal(Number(movies.rows[0]?.count), recordsPerFile);
    assert.equal(Number(links.rows[0]?.count), recordsPerFile);
    assert.equal(Number(ratings.rows[0]?.count), recordsPerFile);
    assert.equal(Number(nonCompletedChunks.rows[0]?.count), 0);
  } finally {
    client.close();
  }
}

async function assertQueuesAreDrained(): Promise<void> {
  const { stdout } = await runCompose('exec', '-T', 'rabbitmq', 'rabbitmqctl', 'list_queues', 'name', 'messages_ready', 'messages_unacknowledged');
  for (const line of stdout.trim().split('\n')) {
    const [, ready, unacknowledged] = line.trim().split(/\s+/);
    if (!/^\d+$/.test(ready ?? '') || !/^\d+$/.test(unacknowledged ?? '')) continue;
    assert.equal(Number(ready), 0, `Fila pendente: ${line}`);
    assert.equal(Number(unacknowledged), 0, `Fila não confirmada: ${line}`);
  }
}

async function assertWorkerHasNoLocks(): Promise<void> {
  const { stdout } = await runCompose('logs', '--no-color', 'dataset-import-reader', 'dataset-import-writer');
  assert.equal(stdout.includes('SQLITE_BUSY'), false, 'O worker registrou SQLITE_BUSY durante o teste.');
  assert.equal(stdout.includes('invalid_encoding'), false, 'O worker classificou um CSV válido como UTF-8 inválido.');
  assert.equal(stdout.includes('socket usage at capacity'), false, 'O writer abriu downloads demais em paralelo.');
}

async function runMigration(): Promise<void> {
  let failure: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await runCompose('run', '--rm', 'migrate');
      return;
    } catch (error) {
      failure = error;
      if (attempt < 2) await delay(1_000);
    }
  }

  throw failure;
}

async function runCompose(...arguments_: string[]): Promise<{ stderr: string; stdout: string }> {
  return executeFile('docker', [...composeArguments, ...arguments_], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BFF_HOST_PORT: '127.0.0.1:4333',
      MINIO_API_HOST_PORT: '127.0.0.1:29000',
      MINIO_CONSOLE_HOST_PORT: '127.0.0.1:29001',
      RABBITMQ_AMQP_HOST_PORT: '127.0.0.1:25672',
      RABBITMQ_MANAGEMENT_HOST_PORT: '127.0.0.1:25673',
      SQLD_GRPC_HOST_PORT: '127.0.0.1:28081',
      SQLD_HTTP_HOST_PORT: '127.0.0.1:28080',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function acquireLock(): Promise<void> {
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error('Já existe uma execução da integração de importação em andamento.');
    }
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredImportToken(): string {
  const token = process.env.DATASET_IMPORT_ADMIN_TOKEN;
  if (!token) throw new Error('DATASET_IMPORT_ADMIN_TOKEN precisa estar definido no .env local.');
  return token;
}
