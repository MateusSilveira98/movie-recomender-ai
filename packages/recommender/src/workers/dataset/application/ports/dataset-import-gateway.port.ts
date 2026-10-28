import type {
  DatasetDependency,
  DatasetDiagnosticsPage,
  DatasetDiagnosticsPagination,
  DatasetFileType,
  DatasetFailure,
  DatasetImportDiagnosticInput,
  DatasetImportJob,
  DatasetImportResult,
  DatasetUpload,
  DatasetUploadInput,
} from '../../domain/dataset-import-queue.types.js';
import type { DatasetImportChunk } from '../../domain/dataset-import-chunk.types.js';

export interface StoredDatasetImportJob extends DatasetImportJob {
  fileName: string;
  objectKey: string | null;
  sizeBytes: number;
  storagePath: string | null;
}

export interface DatasetImportDiagnosticsCollector {
  failures(): DatasetFailure[];
  flush(): Promise<void>;
  record(input: DatasetImportDiagnosticInput): Promise<void>;
}

export interface DatasetImportGateway {
  claimNextJob(): Promise<StoredDatasetImportJob | null>;
  clearDiagnostics(uploadId: string): Promise<void>;
  clearRatingKeys(uploadId: string): Promise<void>;
  completeJob(job: StoredDatasetImportJob, result: DatasetImportResult): Promise<void>;
  finalizeCompletedRatingJob(job: StoredDatasetImportJob): Promise<void>;
  createCheckpoints(job: StoredDatasetImportJob): Promise<void>;
  createDiagnostics(uploadId: string): DatasetImportDiagnosticsCollector;
  createUpload(upload: DatasetUploadInput): Promise<DatasetUpload>;
  deleteTemporaryFile(filePath: string): Promise<void>;
  failJob(job: StoredDatasetImportJob, message: string, failures: DatasetFailure[]): Promise<void>;
  findUpload(uploadId: string): Promise<DatasetUpload | null>;
  getDependencyCounts(type: DatasetFileType): Promise<{ links: number; movies: number }>;
  heartbeatJob(job: StoredDatasetImportJob, progress?: Record<string, unknown>): Promise<void>;
  importFile(job: StoredDatasetImportJob, diagnostics: DatasetImportDiagnosticsCollector): Promise<DatasetImportResult>;
  listDiagnostics(uploadId: string, pagination: DatasetDiagnosticsPagination): Promise<DatasetDiagnosticsPage | null>;
  listChunks(jobId: string): Promise<DatasetImportChunk[]>;
  listJobs(): Promise<DatasetImportJob[]>;
  listUploads(): Promise<DatasetUpload[]>;
  requeueInterruptedJobs(): Promise<void>;
  reconcileStagedImports(): Promise<void>;
  requeueWaitingJobs(dependency: DatasetDependency['type']): Promise<void>;
  reportJobFailure(job: StoredDatasetImportJob, error: unknown, stage: string): void;
  reportSecondaryFailure?(job: StoredDatasetImportJob, operation: string, error: unknown): void;
  reportJobStage?(job: StoredDatasetImportJob, stage: string, status: string): void;
  reportReconciliation?(event: string, details?: Record<string, unknown>): void;
  reportProcessorFailure(error: unknown): void;
  validateFileStructure(
    type: DatasetFileType,
    filePath: string,
    diagnostics: DatasetImportDiagnosticsCollector,
  ): Promise<boolean>;
  waitForDependencies(job: StoredDatasetImportJob, dependencies: DatasetDependency[]): Promise<void>;
}
