import { unlink } from 'node:fs/promises';
import { DATASET_FILE_TYPES, type DatasetImportQueue } from '@pkg/recommender';
import type { RequestHandler } from 'express';
import { createAsyncHandler } from '../../../middlewares/request-logger.middleware.js';
import { submitDatasetImport } from '../data-access/dataset-import-submission.service.js';
import { findDatasetImportStatus, listDatasetImportStatuses } from '../data-access/dataset-import-status.service.js';

export function createDatasetUploadController(): RequestHandler {
  return createAsyncHandler(async (request, response) => {
    const file = request.file;
    const type = request.body.type;

    if (!file || !isDatasetFileType(type)) {
      if (file) {
        await unlink(file.path).catch(() => undefined);
      }

      response.status(400).json({ error: 'Envie um arquivo CSV no campo file e um type valido: movies, links, credits ou ratings.' });
      return;
    }

    const upload = await submitDatasetImport({
      fileName: file.originalname,
      filePath: file.path,
      sizeBytes: file.size,
      type,
    });

    response.status(202).json({ upload });
  });
}

export function createListDatasetUploadsController(datasetImportQueue: DatasetImportQueue): RequestHandler {
  return createAsyncHandler(async (_request, response) => {
    const [uploads, statuses] = await Promise.all([datasetImportQueue.listUploads(), listDatasetImportStatuses()]);
    const persisted = new Set(uploads.map((upload) => upload.id));
    response.json({ uploads: [...uploads, ...statuses.filter((status) => !persisted.has(status.id))] });
  });
}

export function createGetDatasetUploadController(datasetImportQueue: DatasetImportQueue): RequestHandler {
  return createAsyncHandler(async (request, response) => {
    const upload = await datasetImportQueue.findUpload(request.params.uploadId);

    if (!upload) {
      const status = await findDatasetImportStatus(request.params.uploadId);
      if (status) {
        response.json({ upload: status });
        return;
      }
      response.status(404).json({ error: `Upload ${request.params.uploadId} nao encontrado.` });
      return;
    }

    response.json({ upload });
  });
}

export function createListDatasetImportDiagnosticsController(datasetImportQueue: DatasetImportQueue): RequestHandler {
  return createAsyncHandler(async (request, response) => {
    const pagination = parseDiagnosticsPagination(request.query);

    if (!pagination) {
      response.status(400).json({ error: 'Os parametros limit e offset devem ser inteiros validos. limit deve estar entre 1 e 100.' });
      return;
    }

    const page = await datasetImportQueue.listDiagnostics(request.params.uploadId, pagination);

    if (!page) {
      response.status(404).json({ error: `Upload ${request.params.uploadId} nao encontrado.` });
      return;
    }

    response.json(page);
  });
}

export function createListDatasetImportJobsController(datasetImportQueue: DatasetImportQueue): RequestHandler {
  return createAsyncHandler(async (_request, response) => {
    const [jobs, statuses] = await Promise.all([datasetImportQueue.listJobs(), listDatasetImportStatuses()]);
    const materializedUploads = new Set(jobs.map((job) => job.uploadId));
    const pending = statuses
      .filter((status) => !materializedUploads.has(status.id))
      .map((status) => ({ uploadId: status.id, type: status.type, stage: status.stage, errorMessage: status.errorMessage }));
    response.json({ jobs: [...jobs, ...pending] });
  });
}

function isDatasetFileType(value: unknown): value is (typeof DATASET_FILE_TYPES)[number] {
  return typeof value === 'string' && DATASET_FILE_TYPES.some((type) => type === value);
}

function parseDiagnosticsPagination(query: Record<string, unknown>): { limit: number; offset: number } | null {
  const limit = parseIntegerQuery(query.limit, 50);
  const offset = parseIntegerQuery(query.offset, 0);

  if (limit === null || offset === null || limit < 1 || limit > 100 || offset < 0) {
    return null;
  }

  return { limit, offset };
}

function parseIntegerQuery(value: unknown, fallback: number): number | null {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
