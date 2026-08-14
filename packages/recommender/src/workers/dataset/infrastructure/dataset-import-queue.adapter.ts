import { rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { Client } from '@libsql/client';
import { logger } from '@pkg/logger';
import type {
  DatasetImportDiagnosticsCollector,
  DatasetImportGateway,
  StoredDatasetImportJob,
} from '../application/ports/dataset-import-gateway.port.js';
import type {
  DatasetFileType,
  DatasetImportResult,
} from '../domain/dataset-import-queue.types.js';
import { hasValidUtf8Encoding, readCsvHeader } from './data/csv.reader.js';
import { loadStoredDatasetLinks } from './data/dataset-links.loader.js';
import { createDatasetDiagnostic, validateDatasetHeaders } from './validation/dataset-csv.validator.js';
import {
  clearDatasetImportDiagnostics,
  createDatasetImportDiagnosticsCollector,
  listDatasetImportDiagnostics,
} from './persistence/dataset-import-diagnostics.repository.js';
import { clearDatasetImportRatingKeys } from './persistence/dataset-import-rating-keys.repository.js';
import {
  claimNextDatasetImportJob,
  completeDatasetImportJob,
  countRows,
  createDatasetUploadWithJob,
  failDatasetImportJob,
  findDatasetUpload,
  listDatasetImportJobs,
  listDatasetUploads,
  requeueInterruptedDatasetImportJobs,
  requeueWaitingDatasetJobs,
  waitForDatasetDependencies,
} from './persistence/dataset-import-queue.repository.js';
import { importCredits, updateMovieFeaturePeople } from './persistence/importers/credits.importer.js';
import { importMovieFeatures } from './persistence/importers/features.importer.js';
import { collectLinkChunkRecords, importLinks } from './persistence/importers/links.importer.js';
import { importMovies } from './persistence/importers/movies.importer.js';
import { collectRatingChunkRecords, collectRatingStats, persistRatingStats } from './persistence/importers/ratings.importer.js';
import { materializeDatasetImportChunks } from './data/dataset-import-chunk-materializer.service.js';
import { claimDatasetImportChunk, claimNextDatasetImportChunk, completeDatasetImportChunk, createDatasetImportChunk, failDatasetImportChunk, listDatasetImportChunks, requeueDatasetImportChunk } from './persistence/dataset-import-chunks.repository.js';
import type { DatasetImportChunkMessage } from '../application/ports/dataset-import-chunk-dispatcher.port.js';
import {
  countDatasetImportRatingMissingDependencies,
  listDatasetImportRatingChunkStats,
  listDatasetImportRatingChunksMissingStats,
  materializeDatasetImportRatingChunkStats,
  persistAggregatedDatasetImportRatingStats,
  replaceDatasetImportRatingChunkStats,
  resetWaitingDatasetImportRatingChunkMaterialization,
} from './persistence/dataset-import-rating-chunk-stats.repository.js';
import { appendDatasetImportLinkChunkRecords, clearDatasetImportLinkChunkRecords, listDatasetImportLinkChunkRecordsPage } from './persistence/dataset-import-link-chunk-records.repository.js';
import { readDatasetImportChunkRecordBatches, readDatasetImportChunkRecords } from './data/dataset-import-chunk.reader.js';
import type { DatasetImportChunkPayloadReader } from './storage/dataset-import-chunk-payload-reader.js';
import type { MovieRatingStats } from '../domain/dataset.types.js';
import type { DatasetImportChunkMessageHandler } from './messaging/rabbitmq-dataset-import-chunk-consumer.adapter.js';
import { collectCreditChunkRecords, collectMovieChunkRecords, promoteCredits, promoteMovies } from './persistence/importers/movie-credit-chunks.importer.js';
import { appendStagedCreditRecords, appendStagedMovieRecords, clearStagedCreditRecords, clearStagedMovieRecords, listStagedCreditRecordsPage, listStagedMovieRecordsPage } from './persistence/dataset-import-movie-credit-chunk-records.repository.js';
import { appendDatasetImportRatingRecords, clearDatasetImportRatingRecords } from './persistence/dataset-import-rating-records.repository.js';

const localPayloadReader: DatasetImportChunkPayloadReader = {
  readBatches: readDatasetImportChunkRecordBatches,
  readRecords: readDatasetImportChunkRecords,
};

export function createSqlDatasetImportGateway(client: Client): DatasetImportGateway {
  return {
    claimNextJob: () => claimNextDatasetImportJob(client),
    clearDiagnostics: (uploadId) => clearDatasetImportDiagnostics(client, uploadId),
    clearRatingKeys: (uploadId) => clearDatasetImportRatingKeys(client, uploadId),
    completeJob: (job, result) => completeDatasetImportJob(client, job, result),
    createCheckpoints: (job) => createCheckpoints(job),
    createDiagnostics: (uploadId) => createDatasetImportDiagnosticsCollector(client, uploadId),
    createUpload: (upload) => createDatasetUploadWithJob(client, upload),
    deleteTemporaryFile: removeTemporaryFile,
    failJob: (job, message, failures) => failDatasetImportJob(client, job, message, failures),
    findUpload: (uploadId) => findDatasetUpload(client, uploadId),
    getDependencyCounts: async (type) => ({
      links: type === 'ratings' ? await countRows(client, 'dataset_movie_links') : 1,
      movies: type === 'credits' || type === 'ratings' ? await countRows(client, 'movies') : 1,
    }),
    importFile: (job, diagnostics) => importFile(job, diagnostics),
    listDiagnostics: (uploadId, pagination) => listDatasetImportDiagnostics(client, uploadId, pagination),
    listChunks: (jobId) => listDatasetImportChunks(client, jobId),
    listJobs: () => listDatasetImportJobs(client),
    listUploads: () => listDatasetUploads(client),
    requeueInterruptedJobs: () => requeueInterruptedDatasetImportJobs(client),
    reconcileStagedImports: () => reconcileWaitingImports(client),
    requeueWaitingJobs: (dependency) => requeueWaitingDatasetJobs(client, dependency),
    reportJobFailure: (job, error) => logger.error({ component: 'dataset-import-queue', error: getErrorName(error), event: 'job_failed', jobId: job.id, type: job.type }),
    reportProcessorFailure: (error) => logger.error({ component: 'dataset-import-queue', error: getErrorMessage(error), event: 'processor_failed' }),
    validateFileStructure,
    waitForDependencies: (job, dependencies) => waitForDatasetDependencies(client, job, dependencies),
  };

  async function createCheckpoints(job: StoredDatasetImportJob): Promise<void> {
    if (!job.storagePath) {
      return;
    }

    await materializeDatasetImportChunks(job.storagePath, `${job.storagePath}.chunks`, async (chunk) => {
      await createDatasetImportChunk(client, job.id, chunk);
    }, datasetImportChunkSize());
  }

  async function validateFileStructure(
    type: DatasetFileType,
    filePath: string,
    diagnostics: DatasetImportDiagnosticsCollector,
  ): Promise<boolean> {
    if (!await hasValidUtf8Encoding(filePath)) {
      await diagnostics.record(createDatasetDiagnostic({ lineEnd: null, lineStart: null }, {
        category: 'structure',
        field: null,
        message: 'O arquivo deve usar codificacao UTF-8 valida.',
        reason: 'invalid_encoding',
        ruleCode: 'utf8_encoding',
        value: null,
      }));
      return false;
    }

    const header = await readCsvHeader(filePath);
    const headerIssues = validateDatasetHeaders(type, header);

    if (headerIssues.length > 0) {
      await recordDiagnostics(diagnostics, headerIssues);
      return false;
    }

    return true;
  }

  async function importFile(job: StoredDatasetImportJob, diagnostics: DatasetImportDiagnosticsCollector): Promise<DatasetImportResult> {
    const filePath = job.storagePath as string;

    if (job.type === 'movies') {
      const movieImport = await importMovies(client, filePath, await loadStoredDatasetLinks(client), diagnostics);
      await importMovieFeatures(client, movieImport.featureDrafts);
      return resultFor(movieImport.processedCount, movieImport.importedCount, movieImport.rejectedCount, 0, diagnostics);
    }

    if (job.type === 'links') {
      const linksImport = await importLinks(client, filePath, diagnostics);
      return resultFor(linksImport.processedRows, linksImport.importedRows, linksImport.rejectedRows, 0, diagnostics);
    }

    const knownMovieIds = await loadKnownMovieIds();

    if (job.type === 'credits') {
      const featureDrafts = new Map();
      const creditsImport = await importCredits(client, filePath, knownMovieIds, featureDrafts, diagnostics);
      await updateMovieFeaturePeople(client, featureDrafts);
      return resultFor(
        creditsImport.processedRows,
        creditsImport.importedRows,
        creditsImport.rejectedRows,
        creditsImport.missingMovieRows,
        diagnostics,
      );
    }

    const ratingsImport = await processRatingChunks(job, knownMovieIds, diagnostics);
    return resultFor(
      ratingsImport.processedRows,
      ratingsImport.importedRows,
      ratingsImport.rejectedRows,
      ratingsImport.missingDependencyRows,
      diagnostics,
    );
  }

  async function processRatingChunks(
    job: StoredDatasetImportJob,
    knownMovieIds: Set<string>,
    diagnostics: DatasetImportDiagnosticsCollector,
  ): Promise<{ importedRows: number; missingDependencyRows: number; processedRows: number; rejectedRows: number }> {
    const linksByMovieLensId = (await loadStoredDatasetLinks(client)).byMovieLensId;
    let chunk = await claimNextDatasetImportChunk(client, job.id);

    while (chunk) {
      try {
        const chunkId = chunk.id;
        const collected = await collectRatingStats(
          readDatasetImportChunkRecords(chunk.payloadPath, chunk.contentHash),
          linksByMovieLensId,
          knownMovieIds,
          diagnostics,
          client,
          job.uploadId,
          chunkId,
        );
        await replaceDatasetImportRatingChunkStats(client, chunkId, [...collected.statsByMovieId.values()].map((stats) => ({
          chunkId,
          firstRatingAt: toIsoDate(stats.firstTimestamp),
          lastRatingAt: toIsoDate(stats.lastTimestamp),
          movieId: stats.movieId,
          movieLensId: stats.movieLensId,
          ratingCount: stats.count,
          ratingM2: stats.m2,
          ratingMax: stats.max,
          ratingMean: stats.mean,
          ratingMin: stats.min,
          ratingSum: stats.sum,
        })));
        await completeDatasetImportChunk(client, chunkId, collected.result);
      } catch (error) {
        await failDatasetImportChunk(client, chunk.id, 'Falha ao processar o chunk de avaliações.');
        throw error;
      }

      chunk = await claimNextDatasetImportChunk(client, job.id);
    }

    const chunks = await listDatasetImportChunks(client, job.id);
    if (chunks.some((item) => item.status !== 'completed')) {
      throw new Error('Há chunks de avaliações que não foram concluídos.');
    }

    await consolidateRatingChunks(chunks.map((item) => item.id));
    return chunks.reduce((summary, item) => ({
      importedRows: summary.importedRows + item.importedRows,
      missingDependencyRows: summary.missingDependencyRows + item.missingDependencyRows,
      processedRows: summary.processedRows + item.processedRows,
      rejectedRows: summary.rejectedRows + item.rejectedRows,
    }), { importedRows: 0, missingDependencyRows: 0, processedRows: 0, rejectedRows: 0 });
  }

  async function consolidateRatingChunks(chunkIds: readonly string[]): Promise<void> {
    const statsByMovieId = new Map<string, MovieRatingStats>();

    for (const chunkId of chunkIds) {
      for (const stat of await listDatasetImportRatingChunkStats(client, chunkId)) {
        const current = statsByMovieId.get(stat.movieId);
        const next = toMovieRatingStats(stat);
        statsByMovieId.set(stat.movieId, current ? mergeMovieRatingStats(current, next) : next);
      }
    }

    await persistRatingStats(client, statsByMovieId.values());
  }

  async function loadKnownMovieIds(): Promise<Set<string>> {
    const result = await client.execute('SELECT id FROM movies');
    return new Set(result.rows.map((row) => String(row.id)));
  }
}

function datasetImportChunkSize(): number | undefined {
  const configured = Number(process.env.DATASET_IMPORT_CHUNK_RECORD_COUNT);
  return Number.isInteger(configured) && configured > 0 ? configured : undefined;
}

export function createSqlDatasetImportRatingChunkHandler(client: Client, payloadReader: DatasetImportChunkPayloadReader = localPayloadReader): {
  fail(message: DatasetImportChunkMessage): Promise<void>;
  process(message: DatasetImportChunkMessage): Promise<void>;
} {
  return { fail, process };

  async function process(message: DatasetImportChunkMessage): Promise<void> {
    const chunk = await claimDatasetImportChunk(client, message.jobId, message.chunkId);
    if (!chunk) return;

    const job = await findRatingJob(client, message);
    if (!job) return;

    const diagnostics = createDatasetImportDiagnosticsCollector(client, job.uploadId);

    try {
      const seen = new Set<string>();
      await clearDatasetImportRatingRecords(client, chunk.id);
      const result = await collectChunkBatches(
        payloadReader.readBatches(chunk.payloadPath, chunk.contentHash),
        async (records) => {
          const collected = await collectRatingChunkRecords(records, diagnostics, client, job.uploadId, chunk.id, seen);
          await appendDatasetImportRatingRecords(client, chunk.id, collected.records);
          return collected.result;
        },
      );
      await diagnostics.flush();
      await completeDatasetImportChunk(client, chunk.id, result);
    } catch (error) {
      await diagnostics.flush();
      await requeueDatasetImportChunk(client, chunk.id, 'Falha temporária ao processar o chunk de avaliações.');
      throw error;
    }
  }

  async function fail(message: DatasetImportChunkMessage): Promise<void> {
    const job = await findRatingJob(client, message);
    if (!job) return;

    await failDatasetImportChunk(client, message.chunkId, 'O chunk excedeu o limite de tentativas.');
    await failDatasetImportJob(client, job, 'Um chunk de avaliações excedeu o limite de tentativas.', await listPersistedFailures(client, job.uploadId));
    if (job.storagePath) await removeTemporaryFile(job.storagePath);
  }

}

export function createSqlDatasetImportLinkChunkHandler(client: Client, payloadReader: DatasetImportChunkPayloadReader = localPayloadReader): {
  fail(message: DatasetImportChunkMessage): Promise<void>;
  process(message: DatasetImportChunkMessage): Promise<void>;
} {
  return { fail, process };

  async function process(message: DatasetImportChunkMessage): Promise<void> {
    const chunk = await claimDatasetImportChunk(client, message.jobId, message.chunkId);
    if (!chunk) return;

    const job = await findChunkJob(client, message, 'links');
    if (!job) return;

    const diagnostics = createDatasetImportDiagnosticsCollector(client, job.uploadId);

    try {
      const seenMovieLensIds = new Set<number>();
      await clearDatasetImportLinkChunkRecords(client, chunk.id);
      const result = await collectChunkBatches(
        payloadReader.readBatches(chunk.payloadPath, chunk.contentHash),
        async (records) => {
          const collected = await collectLinkChunkRecords(client, records, job.uploadId, chunk.id, diagnostics, seenMovieLensIds);
          await appendDatasetImportLinkChunkRecords(client, chunk.id, collected.records);
          return { ...collected.result, missingDependencyRows: 0 };
        },
      );
      await diagnostics.flush();
      await completeDatasetImportChunk(client, chunk.id, result);
      await finalizeLinkJob(job);
    } catch (error) {
      await diagnostics.flush();
      await requeueDatasetImportChunk(client, chunk.id, 'Falha temporária ao processar o chunk de vínculos.');
      throw error;
    }
  }

  async function fail(message: DatasetImportChunkMessage): Promise<void> {
    const job = await findChunkJob(client, message, 'links');
    if (!job) return;

    await failDatasetImportChunk(client, message.chunkId, 'O chunk excedeu o limite de tentativas.');
    await failDatasetImportJob(client, job, 'Um chunk de vínculos excedeu o limite de tentativas.', await listPersistedFailures(client, job.uploadId));
    if (job.storagePath) await removeTemporaryFile(job.storagePath);
  }

  async function finalizeLinkJob(job: { id: string; storagePath: string | null; uploadId: string }): Promise<void> {
    const chunks = await listDatasetImportChunks(client, job.id);
    if (chunks.length === 0 || chunks.some((chunk) => chunk.status !== 'completed')) return;

    await promoteLinkChunks(chunks.map((chunk) => chunk.id));

    const summary = chunks.reduce((total, chunk) => ({
      imported: total.imported + chunk.importedRows,
      processed: total.processed + chunk.processedRows,
      rejected: total.rejected + chunk.rejectedRows,
      waitingDependencies: total.waitingDependencies + chunk.missingDependencyRows,
    }), { imported: 0, processed: 0, rejected: 0, waitingDependencies: 0 });
    await completeDatasetImportJob(client, job, { dependencies: [], failures: await listPersistedFailures(client, job.uploadId), summary });
    if (job.storagePath) await removeTemporaryFile(job.storagePath);
    await resetWaitingDatasetImportRatingChunkMaterialization(client);
    await reconcileWaitingImports(client);
  }

  async function promoteLinkChunks(chunkIds: readonly string[]): Promise<void> {
    for await (const records of readStagingPages((limit, offset) => listDatasetImportLinkChunkRecordsPage(client, chunkIds, limit, offset))) {
      await client.batch(records.flatMap((record) => [
        {
          sql: `INSERT INTO dataset_movie_links (movie_lens_id, tmdb_id, created_at, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(movie_lens_id) DO UPDATE SET tmdb_id = excluded.tmdb_id, updated_at = CURRENT_TIMESTAMP
            WHERE dataset_movie_links.tmdb_id = excluded.tmdb_id`,
          args: [record.movieLensId, String(record.tmdbId)],
        },
        {
          sql: `UPDATE OR IGNORE movies SET movie_lens_id = ?
            WHERE tmdb_id = ? AND (movie_lens_id IS NULL OR movie_lens_id = ?)`,
          args: [record.movieLensId, String(record.tmdbId), record.movieLensId],
        },
      ]), 'write');
    }
  }
}

export function createSqlDatasetImportMovieChunkHandler(client: Client, payloadReader: DatasetImportChunkPayloadReader = localPayloadReader): DatasetImportChunkMessageHandler {
  return createMovieOrCreditHandler(client, 'movies', async (job, chunk, diagnostics) => {
    const links = await loadStoredDatasetLinks(client);
    const seenMovieIds = new Set<string>();
    await clearStagedMovieRecords(client, chunk.id);
    return collectChunkBatches(payloadReader.readBatches(chunk.payloadPath, chunk.contentHash), async (records) => {
      const collected = await collectMovieChunkRecords(client, records, links, job.uploadId, chunk.id, diagnostics, seenMovieIds);
      await appendStagedMovieRecords(client, chunk.id, collected.records);
      return collected.result;
    });
  }, async (chunks) => {
    for await (const records of readStagingPages((limit, offset) => listStagedMovieRecordsPage(client, chunks.map((chunk) => chunk.id), limit, offset))) {
      await promoteMovies(client, records);
    }
    return 0;
  });
}

export function createSqlDatasetImportCreditChunkHandler(client: Client, payloadReader: DatasetImportChunkPayloadReader = localPayloadReader): DatasetImportChunkMessageHandler {
  return createMovieOrCreditHandler(client, 'credits', async (job, chunk, diagnostics) => {
    const seenMovieIds = new Set<string>();
    await clearStagedCreditRecords(client, chunk.id);
    return collectChunkBatches(payloadReader.readBatches(chunk.payloadPath, chunk.contentHash), async (records) => {
      const collected = await collectCreditChunkRecords(client, records, job.uploadId, chunk.id, diagnostics, seenMovieIds);
      await appendStagedCreditRecords(client, chunk.id, collected.records);
      return collected.result;
    });
  }, async (chunks) => promoteCreditChunks(client, chunks.map((chunk) => chunk.id)));
}

type ChunkImportSummary = {
  importedRows: number;
  missingDependencyRows: number;
  processedRows: number;
  rejectedRows: number;
};

async function collectChunkBatches(
  batches: AsyncIterable<readonly import('./data/csv.reader.js').CsvRecord[]>,
  collect: (records: readonly import('./data/csv.reader.js').CsvRecord[]) => Promise<ChunkImportSummary>,
): Promise<ChunkImportSummary> {
  let summary: ChunkImportSummary = { importedRows: 0, missingDependencyRows: 0, processedRows: 0, rejectedRows: 0 };

  for await (const records of batches) {
    const result = await collect(records);
    summary = {
      importedRows: summary.importedRows + result.importedRows,
      missingDependencyRows: summary.missingDependencyRows + result.missingDependencyRows,
      processedRows: summary.processedRows + result.processedRows,
      rejectedRows: summary.rejectedRows + result.rejectedRows,
    };
  }

  return summary;
}

function createMovieOrCreditHandler(
  client: Client,
  type: 'movies' | 'credits',
  collect: (job: { uploadId: string }, chunk: import('../domain/dataset-import-chunk.types.js').DatasetImportChunk, diagnostics: DatasetImportDiagnosticsCollector) => Promise<import('./persistence/dataset-import-chunks.repository.js').ChunkImportResult>,
  promote: (chunks: readonly import('../domain/dataset-import-chunk.types.js').DatasetImportChunk[]) => Promise<number>,
): DatasetImportChunkMessageHandler {
  return { fail, process };

  async function process(message: DatasetImportChunkMessage): Promise<void> {
    const chunk = await claimDatasetImportChunk(client, message.jobId, message.chunkId);
    if (!chunk) return;
    const job = await findChunkJob(client, message, type);
    if (!job) return;
    const diagnostics = createDatasetImportDiagnosticsCollector(client, job.uploadId);
    try {
      await completeDatasetImportChunk(client, chunk.id, await collect(job, chunk, diagnostics));
      await diagnostics.flush();
      await finalize(job);
    } catch (error) {
      await diagnostics.flush();
      await requeueDatasetImportChunk(client, chunk.id, 'Falha temporária ao processar o chunk.');
      logger.error({
        component: 'dataset-import-chunk',
        error: getErrorMessage(error),
        event: 'chunk_processing_failed',
        jobId: job.id,
        chunkId: chunk.id,
        type,
      });
      throw error;
    }
  }

  async function fail(message: DatasetImportChunkMessage): Promise<void> {
    const job = await findChunkJob(client, message, type);
    if (!job) return;
    await failDatasetImportChunk(client, message.chunkId, 'O chunk excedeu o limite de tentativas.');
    await failDatasetImportJob(client, job, 'Um chunk excedeu o limite de tentativas.', await listPersistedFailures(client, job.uploadId));
    if (job.storagePath) await removeTemporaryFile(job.storagePath);
  }

  async function finalize(job: { id: string; storagePath: string | null; uploadId: string }): Promise<void> {
    const chunks = await listDatasetImportChunks(client, job.id);
    if (chunks.length === 0 || chunks.some((chunk) => chunk.status !== 'completed')) return;
    if (type === 'credits' && await countRows(client, 'movies') === 0) {
      await waitForDatasetDependencies(client, job as StoredDatasetImportJob, [{ reason: 'Há registros aguardando filmes cadastrados.', type: 'movies' }], summaryAwaitingPromotion(chunks));
      if (job.storagePath) await removeTemporaryFile(job.storagePath);
      return;
    }
    const missingDependencyRows = await promote(chunks);
    const summary = chunks.reduce((total, chunk) => ({ imported: total.imported + chunk.importedRows, processed: total.processed + chunk.processedRows, rejected: total.rejected + chunk.rejectedRows }), { imported: 0, processed: 0, rejected: 0 });
    if (missingDependencyRows > 0) {
      await waitForDatasetDependencies(client, job as StoredDatasetImportJob, [{ reason: 'Há registros aguardando filmes cadastrados.', type: 'movies' }], missingDependencyRows);
      if (job.storagePath) await removeTemporaryFile(job.storagePath);
      return;
    }
    await completeDatasetImportJob(client, job, { dependencies: [], failures: await listPersistedFailures(client, job.uploadId), summary: { ...summary, waitingDependencies: 0 } });
    if (job.storagePath) await removeTemporaryFile(job.storagePath);
    if (type === 'movies') {
      await resetWaitingDatasetImportRatingChunkMaterialization(client);
      await reconcileWaitingImports(client);
    }
  }
}

async function reconcileWaitingImports(client: Client): Promise<void> {
  await purgeExpiredStagedImports(client);
  const activeMovies = await client.execute({ sql: "SELECT jobs.id, jobs.upload_id, uploads.storage_path FROM dataset_import_jobs jobs JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id WHERE jobs.status = 'processing' AND jobs.file_type = 'movies'", args: [] });
  for (const row of activeMovies.rows) {
    const job = { id: String(row.id), storagePath: row.storage_path === null ? null : String(row.storage_path), uploadId: String(row.upload_id) };
    const chunks = await listDatasetImportChunks(client, job.id);
    if (chunks.length === 0 || chunks.some((chunk) => chunk.status !== 'completed')) continue;
    for await (const records of readStagingPages((limit, offset) => listStagedMovieRecordsPage(client, chunks.map((chunk) => chunk.id), limit, offset))) {
      await promoteMovies(client, records);
    }
    await completeDatasetImportJob(client, job, { dependencies: [], failures: await listPersistedFailures(client, job.uploadId), summary: summarizeChunks(chunks) });
  }

  const activeLinks = await client.execute({ sql: "SELECT jobs.id, jobs.upload_id, uploads.storage_path FROM dataset_import_jobs jobs JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id WHERE jobs.status = 'processing' AND jobs.file_type = 'links'", args: [] });
  for (const row of activeLinks.rows) {
    const job = { id: String(row.id), storagePath: row.storage_path === null ? null : String(row.storage_path), uploadId: String(row.upload_id) };
    const chunks = await listDatasetImportChunks(client, job.id);
    if (chunks.length === 0 || chunks.some((chunk) => chunk.status !== 'completed')) continue;
    await promoteStagedLinks(client, chunks.map((chunk) => chunk.id));
    await completeDatasetImportJob(client, job, { dependencies: [], failures: await listPersistedFailures(client, job.uploadId), summary: summarizeChunks(chunks) });
  }

  const activeRatings = await client.execute({ sql: "SELECT jobs.id, jobs.upload_id, uploads.storage_path FROM dataset_import_jobs jobs JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id WHERE jobs.status = 'processing' AND jobs.file_type = 'ratings'", args: [] });
  for (const row of activeRatings.rows) {
    await finalizeStagedRatingJob(client, toStagedJob(row));
  }

  const waitingRatings = await client.execute({ sql: "SELECT jobs.id, jobs.upload_id, uploads.storage_path FROM dataset_import_jobs jobs JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id WHERE jobs.status = 'completed' AND uploads.status = 'partial_error' AND uploads.waiting_dependency_rows > 0 AND uploads.completed_at > datetime('now', '-3 days') AND jobs.file_type = 'ratings'", args: [] });
  for (const row of waitingRatings.rows) {
    const job = toStagedJob(row);
    await finalizeStagedRatingJob(client, job);
    if ((await listDatasetImportRatingChunksMissingStats(client, job.id, 1)).length > 0) return;
  }

  const waitingCredits = await client.execute({ sql: "SELECT jobs.id, jobs.upload_id, uploads.storage_path FROM dataset_import_jobs jobs JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id WHERE jobs.status = 'completed' AND uploads.status = 'partial_error' AND uploads.waiting_dependency_rows > 0 AND uploads.completed_at > datetime('now', '-3 days') AND jobs.file_type = 'credits'", args: [] });

  for (const row of waitingCredits.rows) {
    const job = { id: String(row.id), storagePath: row.storage_path === null ? null : String(row.storage_path), uploadId: String(row.upload_id) };
    const chunks = await listDatasetImportChunks(client, job.id);
    if (chunks.some((chunk) => chunk.status !== 'completed')) continue;
    if (await countRows(client, 'movies') === 0) {
      await waitForDatasetDependencies(client, job as StoredDatasetImportJob, [{ reason: 'Há registros aguardando filmes cadastrados.', type: 'movies' }], summaryAwaitingPromotion(chunks));
      continue;
    }
    const missing = await promoteCreditChunks(client, chunks.map((chunk) => chunk.id));
    if (missing > 0) {
      await waitForDatasetDependencies(client, job as StoredDatasetImportJob, [{ reason: 'Há registros aguardando filmes cadastrados.', type: 'movies' }], missing);
      continue;
    }
    await completeDatasetImportJob(client, job, { dependencies: [], failures: await listPersistedFailures(client, job.uploadId), summary: summarizeChunks(chunks) });
  }

}

async function finalizeStagedRatingJob(client: Client, job: { id: string; storagePath: string | null; uploadId: string }): Promise<void> {
  const chunks = await listDatasetImportChunks(client, job.id);
  if (chunks.length === 0 || chunks.some((chunk) => chunk.status !== 'completed')) return;

  const ratingStats = await reconcileRatingStats(client, job.id);
  if (ratingStats === null) return;
  if (ratingStats.missingDependencyRows > 0) {
    await waitForDatasetDependencies(client, job as StoredDatasetImportJob, [
      { reason: 'Há avaliações aguardando filmes ou vínculos MovieLens.', type: 'movies' },
      { reason: 'Há avaliações aguardando filmes ou vínculos MovieLens.', type: 'links' },
    ], ratingStats.missingDependencyRows);
    return;
  }

  await completeDatasetImportJob(client, job, {
    dependencies: [],
    failures: await listPersistedFailures(client, job.uploadId),
    summary: summarizeChunks(chunks),
  });
  if (job.storagePath) await removeTemporaryFile(job.storagePath);
}

function toStagedJob(row: Record<string, unknown>): { id: string; storagePath: string | null; uploadId: string } {
  return {
    id: String(row.id),
    storagePath: row.storage_path === null ? null : String(row.storage_path),
    uploadId: String(row.upload_id),
  };
}

async function purgeExpiredStagedImports(client: Client): Promise<void> {
  await client.batch([
    {
      sql: `DELETE FROM dataset_import_chunks
        WHERE job_id IN (
          SELECT jobs.id FROM dataset_import_jobs jobs
          JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id
          WHERE jobs.status = 'completed'
            AND uploads.status = 'partial_error'
            AND uploads.waiting_dependency_rows > 0
            AND uploads.completed_at <= datetime('now', '-3 days')
        )`,
      args: [],
    },
    {
      sql: `UPDATE dataset_uploads
        SET waiting_dependency_rows = 0, dependencies_json = '[]', updated_at = CURRENT_TIMESTAMP
        WHERE status = 'partial_error'
          AND waiting_dependency_rows > 0
          AND completed_at <= datetime('now', '-3 days')`,
      args: [],
    },
  ], 'write');
}

async function promoteStagedLinks(client: Client, chunkIds: readonly string[]): Promise<void> {
  for await (const records of readStagingPages((limit, offset) => listDatasetImportLinkChunkRecordsPage(client, chunkIds, limit, offset))) {
    await client.batch(records.flatMap((record) => [
      {
        sql: `INSERT INTO dataset_movie_links (movie_lens_id, tmdb_id, created_at, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(movie_lens_id) DO UPDATE SET tmdb_id = excluded.tmdb_id, updated_at = CURRENT_TIMESTAMP
          WHERE dataset_movie_links.tmdb_id = excluded.tmdb_id`,
        args: [record.movieLensId, String(record.tmdbId)],
      },
      {
        sql: `UPDATE OR IGNORE movies SET movie_lens_id = ?
          WHERE tmdb_id = ? AND (movie_lens_id IS NULL OR movie_lens_id = ?)`,
        args: [record.movieLensId, String(record.tmdbId), record.movieLensId],
      },
    ]), 'write');
  }
}

function summarizeChunks(chunks: readonly import('../domain/dataset-import-chunk.types.js').DatasetImportChunk[]) {
  return chunks.reduce((total, chunk) => ({
    imported: total.imported + chunk.importedRows,
    processed: total.processed + chunk.processedRows,
    rejected: total.rejected + chunk.rejectedRows,
    waitingDependencies: 0,
  }), { imported: 0, processed: 0, rejected: 0, waitingDependencies: 0 });
}

function summaryAwaitingPromotion(chunks: readonly import('../domain/dataset-import-chunk.types.js').DatasetImportChunk[]): number {
  return chunks.reduce((total, chunk) => total + chunk.processedRows - chunk.rejectedRows, 0);
}

const RATING_STATS_CHUNKS_PER_CYCLE = 20;

async function reconcileRatingStats(
  client: Client,
  jobId: string,
): Promise<{ missingDependencyRows: number } | null> {
  const pendingChunkIds = await listDatasetImportRatingChunksMissingStats(client, jobId, RATING_STATS_CHUNKS_PER_CYCLE);
  let missingDependencyRows = 0;

  for (const chunkId of pendingChunkIds) {
    const result = await materializeDatasetImportRatingChunkStats(client, chunkId);
    missingDependencyRows += result.unresolvedRecords;
  }

  if (pendingChunkIds.length === RATING_STATS_CHUNKS_PER_CYCLE) return null;

  await persistAggregatedDatasetImportRatingStats(client, jobId);
  return { missingDependencyRows: await countDatasetImportRatingMissingDependencies(client, jobId) };
}

const STAGING_PAGE_SIZE = 100;

async function* readStagingPages<T>(readPage: (limit: number, offset: number) => Promise<readonly T[]>): AsyncGenerator<readonly T[]> {
  for (let offset = 0;; offset += STAGING_PAGE_SIZE) {
    const records = await readPage(STAGING_PAGE_SIZE, offset);
    if (records.length === 0) return;
    yield records;
  }
}

async function promoteCreditChunks(client: Client, chunkIds: readonly string[]): Promise<number> {
  let missingDependencyRows = 0;
  for await (const records of readStagingPages((limit, offset) => listStagedCreditRecordsPage(client, chunkIds, limit, offset))) {
    missingDependencyRows += await promoteCredits(client, records);
  }
  return missingDependencyRows;
}

function toIsoDate(timestamp: number | null): string | null {
  return timestamp === null ? null : new Date(timestamp * 1000).toISOString();
}

function toMovieRatingStats(stat: import('../domain/dataset-import-rating-chunk-stats.types.js').DatasetImportRatingChunkStats): MovieRatingStats {
  return {
    count: stat.ratingCount,
    firstTimestamp: toTimestamp(stat.firstRatingAt),
    lastTimestamp: toTimestamp(stat.lastRatingAt),
    max: stat.ratingMax,
    mean: stat.ratingMean,
    min: stat.ratingMin,
    movieId: stat.movieId,
    movieLensId: stat.movieLensId,
    m2: stat.ratingM2,
    sum: stat.ratingSum,
  };
}

function mergeMovieRatingStats(left: MovieRatingStats, right: MovieRatingStats): MovieRatingStats {
  const count = left.count + right.count;
  const delta = right.mean - left.mean;

  return {
    count,
    firstTimestamp: minimumTimestamp(left.firstTimestamp, right.firstTimestamp),
    lastTimestamp: maximumTimestamp(left.lastTimestamp, right.lastTimestamp),
    max: Math.max(left.max, right.max),
    mean: left.mean + (delta * right.count) / count,
    min: Math.min(left.min, right.min),
    movieId: left.movieId,
    movieLensId: left.movieLensId,
    m2: left.m2 + right.m2 + (delta * delta * left.count * right.count) / count,
    sum: left.sum + right.sum,
  };
}

function toTimestamp(value: string | null): number | null {
  return value === null ? null : Math.floor(new Date(value).getTime() / 1000);
}

function minimumTimestamp(left: number | null, right: number | null): number | null {
  return left === null ? right : right === null ? left : Math.min(left, right);
}

function maximumTimestamp(left: number | null, right: number | null): number | null {
  return left === null ? right : right === null ? left : Math.max(left, right);
}

function resultFor(
  processed: number,
  imported: number,
  rejected: number,
  waitingDependencies: number,
  diagnostics: DatasetImportDiagnosticsCollector,
): DatasetImportResult {
  return {
    dependencies: [],
    failures: diagnostics.failures(),
    summary: { imported, processed, rejected, waitingDependencies },
  };
}

async function removeTemporaryFile(filePath: string): Promise<void> {
  if (!isAbsolute(filePath)) return;

  await Promise.all([
    rm(filePath, { force: true }),
    rm(`${filePath}.chunks`, { force: true, recursive: true }),
  ]);
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro desconhecido';
}

async function recordDiagnostics(
  diagnostics: DatasetImportDiagnosticsCollector,
  issues: readonly import('../domain/dataset-import-queue.types.js').DatasetImportDiagnosticInput[],
): Promise<void> {
  for (const issue of issues) {
    await diagnostics.record(issue);
  }
}

async function findRatingJob(client: Client, message: DatasetImportChunkMessage): Promise<{ id: string; storagePath: string | null; uploadId: string } | null> {
  return findChunkJob(client, message, 'ratings');
}

async function findChunkJob(
  client: Client,
  message: DatasetImportChunkMessage,
  type: DatasetFileType,
): Promise<{ id: string; storagePath: string | null; uploadId: string } | null> {
  const result = await client.execute({
    sql: `SELECT jobs.id, jobs.upload_id, uploads.storage_path
      FROM dataset_import_jobs jobs JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id
      WHERE jobs.id = ? AND jobs.file_type = ?`,
    args: [message.jobId, type],
  });
  const row = result.rows[0];

  return row ? {
    id: String(row.id),
    storagePath: row.storage_path === null ? null : String(row.storage_path),
    uploadId: String(row.upload_id),
  } : null;
}

async function listPersistedFailures(client: Client, uploadId: string): Promise<import('../domain/dataset-import-queue.types.js').DatasetFailure[]> {
  const result = await client.execute({
    sql: `SELECT reason, SUM(count) AS count FROM dataset_import_diagnostic_summaries
      WHERE upload_id = ? GROUP BY reason ORDER BY reason`,
    args: [uploadId],
  });

  return result.rows.map((row) => ({
    count: Number(row.count),
    message: 'Foram encontrados registros inválidos durante a importação.',
    reason: String(row.reason) as import('../domain/dataset-import-queue.types.js').DatasetFailureReason,
  }));
}
