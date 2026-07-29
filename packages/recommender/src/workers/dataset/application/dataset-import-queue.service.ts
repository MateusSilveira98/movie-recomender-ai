import { unlink } from 'node:fs/promises';
import type { Client } from '@libsql/client';
import { logger } from '@pkg/logger';
import type {
  DatasetDependency,
  DatasetFailure,
  DatasetFileType,
  DatasetImportJob,
  DatasetImportResult,
  DatasetUpload,
  DatasetUploadInput,
} from '../domain/dataset-import-queue.types.js';
import { resolveMissingDatasetDependencies } from '../domain/dataset-import-dependencies.service.js';
import { readCsvHeaders } from '../infrastructure/data/csv.reader.js';
import { loadStoredDatasetLinks } from '../infrastructure/data/dataset-links.loader.js';
import {
  claimNextDatasetImportJob,
  completeDatasetImportJob,
  countRows,
  createDatasetUploadWithJob,
  failDatasetImportJob,
  findDatasetUpload,
  listDatasetImportJobs,
  listDatasetUploads,
  requeueWaitingDatasetJobs,
  type StoredDatasetImportJob,
  waitForDatasetDependencies,
} from '../infrastructure/persistence/dataset-import-queue.repository.js';
import { importCredits, updateMovieFeaturePeople } from '../infrastructure/persistence/importers/credits.importer.js';
import { importMovieFeatures } from '../infrastructure/persistence/importers/features.importer.js';
import { importLinks } from '../infrastructure/persistence/importers/links.importer.js';
import { importMovies } from '../infrastructure/persistence/importers/movies.importer.js';
import { importRatingStats } from '../infrastructure/persistence/importers/ratings.importer.js';

const REQUIRED_HEADERS: Record<DatasetFileType, string[]> = {
  credits: ['id', 'cast', 'crew'],
  links: ['movieId', 'tmdbId'],
  movies: ['id', 'title', 'genres', 'release_date'],
  ratings: ['movieId', 'rating', 'timestamp'],
};

export interface DatasetImportQueue {
  enqueue(upload: DatasetUploadInput): Promise<DatasetUpload>;
  findUpload(uploadId: string): Promise<DatasetUpload | null>;
  listJobs(): Promise<DatasetImportJob[]>;
  listUploads(): Promise<DatasetUpload[]>;
  processPending(): Promise<void>;
}

export function createDatasetImportQueue(client: Client): DatasetImportQueue {
  let isProcessing = false;
  let recoveredWaitingJobs = false;

  return {
    async enqueue(upload) {
      const queuedUpload = await createDatasetUploadWithJob(client, upload);
      void processPendingSafely();
      return queuedUpload;
    },
    findUpload(uploadId) {
      return findDatasetUpload(client, uploadId);
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
      if (!recoveredWaitingJobs) {
        await requeueWaitingDatasetJobs(client, 'movies');
        await requeueWaitingDatasetJobs(client, 'links');
        recoveredWaitingJobs = true;
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
    if (!job.storagePath) {
      await failDatasetImportJob(client, job, 'Arquivo temporario indisponivel.', invalidHeaderFailure('Arquivo temporario indisponivel.'));
      return;
    }

    try {
      const headers = await readCsvHeaders(job.storagePath);
      const missingHeaders = REQUIRED_HEADERS[job.type].filter((header) => !headers.includes(header));

      if (missingHeaders.length > 0) {
        await failDatasetImportJob(client, job, 'Cabecalho CSV invalido.', invalidHeaderFailure(`Campos obrigatorios ausentes: ${missingHeaders.join(', ')}.`));
        await removeTemporaryFile(job.storagePath);
        return;
      }

      const dependencies = await getMissingDependencies(job.type);

      if (dependencies.length > 0) {
        await waitForDatasetDependencies(client, job, dependencies);
        return;
      }

      const result = await importFile(job);
      await completeDatasetImportJob(client, job, result);
      await removeTemporaryFile(job.storagePath);

      if (result.summary.imported > 0 && (job.type === 'movies' || job.type === 'links')) {
        await requeueWaitingDatasetJobs(client, job.type);
      }

      logger.info({ component: 'dataset-import-queue', event: 'job_completed', importedRows: result.summary.imported, jobId: job.id, type: job.type });
    } catch (error) {
      await failDatasetImportJob(client, job, 'Falha ao processar o arquivo enviado.', invalidHeaderFailure('Nao foi possivel processar o CSV.'));
      await removeTemporaryFile(job.storagePath);
      logger.error({ component: 'dataset-import-queue', error: getErrorName(error), event: 'job_failed', jobId: job.id, type: job.type });
    }
  }

  async function getMissingDependencies(type: DatasetFileType): Promise<DatasetDependency[]> {
    const moviesCount = type === 'credits' || type === 'ratings' ? await countRows(client, 'movies') : 1;
    const linksCount = type === 'ratings' ? await countRows(client, 'dataset_movie_links') : 1;
    return resolveMissingDatasetDependencies(type, { links: linksCount, movies: moviesCount });
  }

  async function importFile(job: StoredDatasetImportJob): Promise<DatasetImportResult> {
    const filePath = job.storagePath as string;

    if (job.type === 'movies') {
      const movieImport = await importMovies(client, filePath, await loadStoredDatasetLinks(client));
      await importMovieFeatures(client, movieImport.featureDrafts);
      return resultFor(movieImport.processedCount, movieImport.importedCount, movieImport.rejectedCount, 0, []);
    }

    if (job.type === 'links') {
      const linksImport = await importLinks(client, filePath);
      return resultFor(linksImport.processedRows, linksImport.importedRows, linksImport.rejectedRows, 0, []);
    }

    const knownMovieIds = await loadKnownMovieIds();

    if (job.type === 'credits') {
      const featureDrafts = new Map();
      const creditsImport = await importCredits(client, filePath, knownMovieIds, featureDrafts);
      await updateMovieFeaturePeople(client, featureDrafts);
      return resultFor(
        creditsImport.processedRows,
        creditsImport.importedRows,
        creditsImport.rejectedRows,
        creditsImport.missingMovieRows,
        creditsImport.missingMovieRows > 0 ? [failure('movie_not_found', creditsImport.missingMovieRows, 'Filmes referenciados nao foram encontrados.')] : [],
      );
    }

    const ratingsImport = await importRatingStats(client, filePath, (await loadStoredDatasetLinks(client)).byMovieLensId, knownMovieIds);
    return resultFor(
      ratingsImport.processedRows,
      ratingsImport.importedRows,
      ratingsImport.rejectedRows,
      ratingsImport.missingDependencyRows,
      ratingsImport.missingDependencyRows > 0 ? [failure('link_not_found', ratingsImport.missingDependencyRows, 'Filmes ou vinculos MovieLens referenciados nao foram encontrados.')] : [],
    );
  }

  async function loadKnownMovieIds(): Promise<Set<string>> {
    const result = await client.execute('SELECT id FROM movies');
    return new Set(result.rows.map((row) => String(row.id)));
  }
}

function resultFor(processed: number, imported: number, rejected: number, waitingDependencies: number, extraFailures: DatasetFailure[]): DatasetImportResult {
  const failures = [
    ...extraFailures,
    ...(rejected > 0 ? [failure('invalid_row', rejected, 'Linhas invalidas foram ignoradas.')] : []),
  ];

  return { dependencies: [], failures, summary: { imported, processed, rejected, waitingDependencies } };
}

function failure(reason: DatasetFailure['reason'], count: number, message: string): DatasetFailure {
  return { count, message, reason };
}

function invalidHeaderFailure(message: string): DatasetFailure {
  return failure('invalid_header', 1, message);
}

async function removeTemporaryFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
