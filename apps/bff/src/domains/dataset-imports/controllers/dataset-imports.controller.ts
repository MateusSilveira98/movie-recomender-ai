import { unlink } from 'node:fs/promises';
import { DATASET_FILE_TYPES, type DatasetImportQueue } from '@pkg/recommender';
import type { RequestHandler } from 'express';

export function createDatasetUploadController(datasetImportQueue: DatasetImportQueue): RequestHandler {
  return async (request, response) => {
    const file = request.file;
    const type = request.body.type;

    if (!file || !isDatasetFileType(type)) {
      if (file) {
        await unlink(file.path).catch(() => undefined);
      }

      response.status(400).json({ error: 'Envie um arquivo CSV no campo file e um type valido: movies, links, credits ou ratings.' });
      return;
    }

    const upload = await datasetImportQueue.enqueue({
      fileName: file.originalname,
      sizeBytes: file.size,
      storagePath: file.path,
      type,
    });

    response.status(202).json({ upload });
  };
}

export function createListDatasetUploadsController(datasetImportQueue: DatasetImportQueue): RequestHandler {
  return async (_request, response) => response.json({ uploads: await datasetImportQueue.listUploads() });
}

export function createGetDatasetUploadController(datasetImportQueue: DatasetImportQueue): RequestHandler {
  return async (request, response) => {
    const upload = await datasetImportQueue.findUpload(request.params.uploadId);

    if (!upload) {
      response.status(404).json({ error: `Upload ${request.params.uploadId} nao encontrado.` });
      return;
    }

    response.json({ upload });
  };
}

export function createListDatasetImportJobsController(datasetImportQueue: DatasetImportQueue): RequestHandler {
  return async (_request, response) => response.json({ jobs: await datasetImportQueue.listJobs() });
}

function isDatasetFileType(value: unknown): value is (typeof DATASET_FILE_TYPES)[number] {
  return typeof value === 'string' && DATASET_FILE_TYPES.some((type) => type === value);
}
