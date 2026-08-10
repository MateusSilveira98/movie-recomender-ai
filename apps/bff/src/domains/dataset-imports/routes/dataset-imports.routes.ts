import type { DatasetImportQueue } from '@pkg/recommender';
import express from 'express';
import {
  createDatasetUploadController,
  createGetDatasetUploadController,
  createListDatasetImportDiagnosticsController,
  createListDatasetImportJobsController,
  createListDatasetUploadsController,
} from '../controllers/dataset-imports.controller.js';
import { uploadDatasetFile } from '../middlewares/dataset-upload.middleware.js';

export function createDatasetImportsRoutes(datasetImportQueue: DatasetImportQueue): express.Router {
  const router = express.Router();

  router.post('/dataset-uploads', uploadDatasetFile, createDatasetUploadController(datasetImportQueue));
  router.get('/dataset-uploads', createListDatasetUploadsController(datasetImportQueue));
  router.get('/dataset-uploads/:uploadId/diagnostics', createListDatasetImportDiagnosticsController(datasetImportQueue));
  router.get('/dataset-uploads/:uploadId', createGetDatasetUploadController(datasetImportQueue));
  router.get('/dataset-import-jobs', createListDatasetImportJobsController(datasetImportQueue));

  return router;
}
