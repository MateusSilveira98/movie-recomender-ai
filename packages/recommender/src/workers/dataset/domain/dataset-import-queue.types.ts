export const DATASET_FILE_TYPES = ['movies', 'links', 'credits', 'ratings'] as const;

export type DatasetFileType = (typeof DATASET_FILE_TYPES)[number];
export type DatasetUploadStatus = 'queued' | 'processing' | 'waiting_dependencies' | 'success' | 'partial_error' | 'error';
export type DatasetImportJobStatus = 'queued' | 'processing' | 'waiting_dependencies' | 'completed' | 'failed';
export type DatasetFailureReason = 'invalid_encoding' | 'invalid_header' | 'invalid_row' | 'invalid_field' | 'movie_not_found' | 'link_not_found' | 'duplicate_value';
export type DatasetDiagnosticCategory = 'structure' | 'validation' | 'reference' | 'integrity';

export interface DatasetFailure {
  count: number;
  message: string;
  reason: DatasetFailureReason;
}

export interface DatasetImportDiagnosticInput {
  category: DatasetDiagnosticCategory;
  field: string | null;
  lineEnd: number | null;
  lineStart: number | null;
  message: string;
  reason: DatasetFailureReason;
  ruleCode: string;
  value: string | null;
}

export interface DatasetImportDiagnostic extends DatasetImportDiagnosticInput {
  fileName: string;
  fileType: DatasetFileType;
  id: string;
}

export interface DatasetDiagnosticSummary {
  category: DatasetDiagnosticCategory;
  count: number;
  field: string | null;
  reason: DatasetFailureReason;
  ruleCode: string;
}

export interface DatasetDiagnosticsPage {
  diagnostics: DatasetImportDiagnostic[];
  page: {
    detectedTotal: number;
    limit: number;
    offset: number;
    total: number;
    truncated: boolean;
  };
  summary: DatasetDiagnosticSummary[];
}

export interface DatasetDiagnosticsPagination {
  limit: number;
  offset: number;
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
