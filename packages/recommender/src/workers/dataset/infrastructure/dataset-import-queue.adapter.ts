import { unlink } from 'node:fs/promises';
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
import { hasValidUtf8Encoding, readCsvHeader, readCsvRecords } from './data/csv.reader.js';
import { loadStoredDatasetLinks } from './data/dataset-links.loader.js';
import { createDatasetDiagnostic, validateDatasetHeaders, validateDatasetRecord } from './validation/dataset-csv.validator.js';
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
import { importLinks } from './persistence/importers/links.importer.js';
import { importMovies } from './persistence/importers/movies.importer.js';
import { importRatingStats } from './persistence/importers/ratings.importer.js';

export function createSqlDatasetImportGateway(client: Client): DatasetImportGateway {
  return {
    claimNextJob: () => claimNextDatasetImportJob(client),
    clearDiagnostics: (uploadId) => clearDatasetImportDiagnostics(client, uploadId),
    clearRatingKeys: (uploadId) => clearDatasetImportRatingKeys(client, uploadId),
    completeJob: (job, result) => completeDatasetImportJob(client, job, result),
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
    listJobs: () => listDatasetImportJobs(client),
    listUploads: () => listDatasetUploads(client),
    requeueInterruptedJobs: () => requeueInterruptedDatasetImportJobs(client),
    requeueWaitingJobs: (dependency) => requeueWaitingDatasetJobs(client, dependency),
    reportJobFailure: (job, error) => logger.error({ component: 'dataset-import-queue', error: getErrorName(error), event: 'job_failed', jobId: job.id, type: job.type }),
    reportProcessorFailure: (error) => logger.error({ component: 'dataset-import-queue', error: getErrorName(error), event: 'processor_failed' }),
    validateFileStructure,
    waitForDependencies: (job, dependencies) => waitForDatasetDependencies(client, job, dependencies),
  };

  async function validateFileStructure(type: DatasetFileType, filePath: string) {
    const issues = [];
    if (!await hasValidUtf8Encoding(filePath)) {
      issues.push(createDatasetDiagnostic({ lineEnd: null, lineStart: null }, {
        category: 'structure',
        field: null,
        message: 'O arquivo deve usar codificacao UTF-8 valida.',
        reason: 'invalid_encoding',
        ruleCode: 'utf8_encoding',
        value: null,
      }));
      return issues;
    }

    const header = await readCsvHeader(filePath);
    const headerIssues = validateDatasetHeaders(type, header);

    if (headerIssues.length > 0) {
      return headerIssues;
    }

    for await (const record of readCsvRecords(filePath)) {
      if (!record.issue) {
        continue;
      }

      issues.push(...validateDatasetRecord(type, record));
    }

    return issues;
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

async function removeTemporaryFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
