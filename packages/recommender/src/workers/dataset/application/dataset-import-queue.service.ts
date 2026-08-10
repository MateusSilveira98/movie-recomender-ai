import type {
  DatasetDiagnosticsPage,
  DatasetDiagnosticsPagination,
  DatasetImportJob,
  DatasetUpload,
  DatasetUploadInput,
} from '../domain/dataset-import-queue.types.js';

export interface DatasetImportQueue {
  enqueue(upload: DatasetUploadInput): Promise<DatasetUpload>;
  findUpload(uploadId: string): Promise<DatasetUpload | null>;
  listDiagnostics(uploadId: string, pagination: DatasetDiagnosticsPagination): Promise<DatasetDiagnosticsPage | null>;
  listJobs(): Promise<DatasetImportJob[]>;
  listUploads(): Promise<DatasetUpload[]>;
  processPending(): Promise<void>;
}

export function createDatasetImportQueue(queue: DatasetImportQueue): DatasetImportQueue {
  return queue;
}
