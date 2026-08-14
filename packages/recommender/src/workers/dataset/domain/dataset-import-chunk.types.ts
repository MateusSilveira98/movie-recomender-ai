export type DatasetImportChunkStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface DatasetImportChunkInput {
  contentHash: string;
  lineEnd: number;
  lineStart: number;
  payloadPath: string;
  recordCount: number;
  sequence: number;
}

export interface DatasetImportChunk extends DatasetImportChunkInput {
  attemptCount: number;
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  id: string;
  importedRows: number;
  jobId: string;
  missingDependencyRows: number;
  processedRows: number;
  rejectedRows: number;
  status: DatasetImportChunkStatus;
}
