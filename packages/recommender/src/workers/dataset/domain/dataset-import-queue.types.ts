export const DATASET_FILE_TYPES = ['movies', 'links', 'credits', 'ratings'] as const;

export type DatasetFileType = (typeof DATASET_FILE_TYPES)[number];
export type DatasetUploadStatus = 'queued' | 'processing' | 'waiting_dependencies' | 'success' | 'partial_error' | 'error';
export type DatasetImportJobStatus = 'queued' | 'processing' | 'waiting_dependencies' | 'completed' | 'failed';

export interface DatasetFailure {
  count: number;
  message: string;
  reason: 'invalid_header' | 'invalid_row' | 'movie_not_found' | 'link_not_found';
}

export interface DatasetDependency {
  reason: string;
  type: 'movies' | 'links';
}

export interface DatasetImportSummary {
  imported: number;
  processed: number;
  rejected: number;
  waitingDependencies: number;
}

export interface DatasetUpload {
  completedAt: string | null;
  createdAt: string;
  dependencies: DatasetDependency[];
  errorMessage: string | null;
  failures: DatasetFailure[];
  fileName: string;
  id: string;
  jobId: string;
  sizeBytes: number;
  status: DatasetUploadStatus;
  summary: DatasetImportSummary;
  type: DatasetFileType;
}

export interface DatasetImportJob {
  attemptCount: number;
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  id: string;
  status: DatasetImportJobStatus;
  type: DatasetFileType;
  uploadId: string;
}

export interface DatasetUploadInput {
  fileName: string;
  sizeBytes: number;
  storagePath: string;
  type: DatasetFileType;
}

export interface DatasetImportResult {
  dependencies: DatasetDependency[];
  failures: DatasetFailure[];
  summary: DatasetImportSummary;
}
