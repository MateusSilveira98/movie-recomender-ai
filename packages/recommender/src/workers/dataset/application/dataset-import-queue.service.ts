import { unlink } from 'node:fs/promises';
import type { Client } from '@libsql/client';
import { logger } from '@pkg/logger';
import type {
  DatasetDependency,
  DatasetDiagnosticsPage,
  DatasetDiagnosticsPagination,
  DatasetFileType,
  DatasetImportJob,
  DatasetImportResult,
  DatasetUpload,
  DatasetUploadInput,
} from '../domain/dataset-import-queue.types.js';
import { resolveMissingDatasetDependencies } from '../domain/dataset-import-dependencies.service.js';
import { hasValidUtf8Encoding, readCsvHeader, readCsvRecords } from '../infrastructure/data/csv.reader.js';
import { loadStoredDatasetLinks } from '../infrastructure/data/dataset-links.loader.js';
import { createDatasetDiagnostic, validateDatasetHeaders, validateDatasetRecord } from '../infrastructure/validation/dataset-csv.validator.js';
import {
  clearDatasetImportDiagnostics,
  createDatasetImportDiagnosticsCollector,
  listDatasetImportDiagnostics,
  type DatasetImportDiagnosticsCollector,
} from '../infrastructure/persistence/dataset-import-diagnostics.repository.js';
import { clearDatasetImportRatingKeys } from '../infrastructure/persistence/dataset-import-rating-keys.repository.js';
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
  type StoredDatasetImportJob,
  waitForDatasetDependencies,
} from '../infrastructure/persistence/dataset-import-queue.repository.js';
import { importCredits, updateMovieFeaturePeople } from '../infrastructure/persistence/importers/credits.importer.js';
import { importMovieFeatures } from '../infrastructure/persistence/importers/features.importer.js';
import { importLinks } from '../infrastructure/persistence/importers/links.importer.js';
import { importMovies } from '../infrastructure/persistence/importers/movies.importer.js';
import { importRatingStats } from '../infrastructure/persistence/importers/ratings.importer.js';

export interface DatasetImportQueue {
  enqueue(upload: DatasetUploadInput): Promise<DatasetUpload>;
  findUpload(uploadId: string): Promise<DatasetUpload | null>;
  listDiagnostics(uploadId: string, pagination: DatasetDiagnosticsPagination): Promise<DatasetDiagnosticsPage | null>;
  listJobs(): Promise<DatasetImportJob[]>;
  listUploads(): Promise<DatasetUpload[]>;
  processPending(): Promise<void>;
}

export function createDatasetImportQueue(client: Client): DatasetImportQueue {
  let isProcessing = false;
  let recoveredJobs = false;

  return {
    async enqueue(upload) {
      const queuedUpload = await createDatasetUploadWithJob(client, upload);
      void processPendingSafely();
      return queuedUpload;
    },
    findUpload(uploadId) {
      return findDatasetUpload(client, uploadId);
    },
    listDiagnostics(uploadId, pagination) {
      return listDatasetImportDiagnostics(client, uploadId, pagination);
    },
    listJobs() {
      return listDatasetImportJobs(client);
    },
    listUploads() {
      return listDatasetUploads(client);
    },
    processPending: processPendingSafely,
  };

  async function processPendingSafely(): Promise<void> {
    if (isProcessing) {
      return;
    }

    isProcessing = true;

    try {
      if (!recoveredJobs) {
        await requeueInterruptedDatasetImportJobs(client);
        await requeueWaitingDatasetJobs(client, 'movies');
        await requeueWaitingDatasetJobs(client, 'links');
        recoveredJobs = true;
      }

      let job = await claimNextDatasetImportJob(client);

      while (job) {
        await processJob(job);
        job = await claimNextDatasetImportJob(client);
      }
    } catch (error) {
      logger.error({ component: 'dataset-import-queue', error: getErrorName(error), event: 'processor_failed' });
    } finally {
      isProcessing = false;
    }
  }

  async function processJob(job: StoredDatasetImportJob): Promise<void> {
    const diagnostics = createDatasetImportDiagnosticsCollector(client, job.uploadId);

    try {
      await clearDatasetImportDiagnostics(client, job.uploadId);
      await clearDatasetImportRatingKeys(client, job.uploadId);

      if (!job.storagePath) {
        await diagnostics.record(createDatasetDiagnostic({ lineEnd: null, lineStart: null }, {
          category: 'structure',
          field: null,
          message: 'O arquivo temporario nao esta mais disponivel.',
          reason: 'invalid_row',
          ruleCode: 'temporary_file_missing',
          value: null,
        }));
        await failWithDiagnostics(job, diagnostics, 'Arquivo temporario indisponivel.');
        return;
      }

      if (!await validateFileStructure(job.type, job.storagePath, diagnostics)) {
        await failWithDiagnostics(job, diagnostics, 'Estrutura do CSV invalida.');
        await removeTemporaryFile(job.storagePath);
        return;
      }

      const dependencies = await getMissingDependencies(job.type);

      if (dependencies.length > 0) {
        await waitForDatasetDependencies(client, job, dependencies);
        return;
      }

      const result = await importFile(job, diagnostics);
      await diagnostics.flush();
      await completeDatasetImportJob(client, job, result);
      await removeTemporaryFile(job.storagePath);

      if (result.summary.imported > 0 && (job.type === 'movies' || job.type === 'links')) {
        await requeueWaitingDatasetJobs(client, job.type);
      }

      logger.info({ component: 'dataset-import-queue', event: 'job_completed', importedRows: result.summary.imported, jobId: job.id, type: job.type });
    } catch (error) {
      await diagnostics.record(createDatasetDiagnostic({ lineEnd: null, lineStart: null }, {
        category: 'structure',
        field: null,
        message: 'Nao foi possivel processar o CSV.',
        reason: 'invalid_row',
        ruleCode: 'processing_failed',
        value: null,
      }));
      await failWithDiagnostics(job, diagnostics, 'Falha ao processar o arquivo enviado.');

      if (job.storagePath) {
        await removeTemporaryFile(job.storagePath);
      }

      logger.error({ component: 'dataset-import-queue', error: getErrorName(error), event: 'job_failed', jobId: job.id, type: job.type });
    }
  }

  async function validateFileStructure(type: DatasetFileType, filePath: string, diagnostics: DatasetImportDiagnosticsCollector): Promise<boolean> {
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

    let hasStructuralIssue = false;

    for await (const record of readCsvRecords(filePath)) {
      if (!record.issue) {
        continue;
      }

      await recordDiagnostics(diagnostics, validateDatasetRecord(type, record));
      hasStructuralIssue = true;
    }

    return !hasStructuralIssue;
  }

  async function failWithDiagnostics(job: StoredDatasetImportJob, diagnostics: DatasetImportDiagnosticsCollector, message: string): Promise<void> {
    await diagnostics.flush();
    await failDatasetImportJob(client, job, message, diagnostics.failures());
  }

  async function getMissingDependencies(type: DatasetFileType): Promise<DatasetDependency[]> {
    const moviesCount = type === 'credits' || type === 'ratings' ? await countRows(client, 'movies') : 1;
    const linksCount = type === 'ratings' ? await countRows(client, 'dataset_movie_links') : 1;
    return resolveMissingDatasetDependencies(type, { links: linksCount, movies: moviesCount });
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

    const ratingsImport = await importRatingStats(client, filePath, (await loadStoredDatasetLinks(client)).byMovieLensId, knownMovieIds, diagnostics, job.uploadId);
    return resultFor(
      ratingsImport.processedRows,
      ratingsImport.importedRows,
      ratingsImport.rejectedRows,
      ratingsImport.missingDependencyRows,
      diagnostics,
    );
  }

  async function loadKnownMovieIds(): Promise<Set<string>> {
    const result = await client.execute('SELECT id FROM movies');
    return new Set(result.rows.map((row) => String(row.id)));
  }
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

async function recordDiagnostics(diagnostics: DatasetImportDiagnosticsCollector, issues: Parameters<DatasetImportDiagnosticsCollector['record']>[0][]): Promise<void> {
  for (const issue of issues) {
    await diagnostics.record(issue);
  }
}

async function removeTemporaryFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
