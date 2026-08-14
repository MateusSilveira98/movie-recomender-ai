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
import { createDatasetImportAccessMiddleware } from '../middlewares/dataset-import-access.middleware.js';

export function createDatasetImportsRoutes(datasetImportQueue: DatasetImportQueue, adminToken: string | undefined): express.Router {
  const router = express.Router();
  const requireDatasetImportAccess = createDatasetImportAccessMiddleware(adminToken);

  router.post('/dataset-uploads', requireDatasetImportAccess, uploadDatasetFile, createDatasetUploadController());
  router.get('/dataset-uploads', requireDatasetImportAccess, createListDatasetUploadsController(datasetImportQueue));
  router.get('/dataset-uploads/:uploadId/diagnostics', requireDatasetImportAccess, createListDatasetImportDiagnosticsController(datasetImportQueue));
  router.get('/dataset-uploads/:uploadId', requireDatasetImportAccess, createGetDatasetUploadController(datasetImportQueue));
  router.get('/dataset-import-jobs', requireDatasetImportAccess, createListDatasetImportJobsController(datasetImportQueue));

  return router;
}
