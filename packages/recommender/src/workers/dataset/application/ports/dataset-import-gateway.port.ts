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

export interface StoredDatasetImportJob extends DatasetImportJob {
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
  createDiagnostics(uploadId: string): DatasetImportDiagnosticsCollector;
  createUpload(upload: DatasetUploadInput): Promise<DatasetUpload>;
  deleteTemporaryFile(filePath: string): Promise<void>;
  failJob(job: StoredDatasetImportJob, message: string, failures: DatasetFailure[]): Promise<void>;
  findUpload(uploadId: string): Promise<DatasetUpload | null>;
  getDependencyCounts(type: DatasetFileType): Promise<{ links: number; movies: number }>;
  importFile(job: StoredDatasetImportJob, diagnostics: DatasetImportDiagnosticsCollector): Promise<DatasetImportResult>;
  listDiagnostics(uploadId: string, pagination: DatasetDiagnosticsPagination): Promise<DatasetDiagnosticsPage | null>;
  listJobs(): Promise<DatasetImportJob[]>;
  listUploads(): Promise<DatasetUpload[]>;
  requeueInterruptedJobs(): Promise<void>;
  requeueWaitingJobs(dependency: DatasetDependency['type']): Promise<void>;
  reportJobFailure(job: StoredDatasetImportJob, error: unknown): void;
  reportProcessorFailure(error: unknown): void;
  validateFileStructure(type: DatasetFileType, filePath: string): Promise<DatasetImportDiagnosticInput[]>;
  waitForDependencies(job: StoredDatasetImportJob, dependencies: DatasetDependency[]): Promise<void>;
}
