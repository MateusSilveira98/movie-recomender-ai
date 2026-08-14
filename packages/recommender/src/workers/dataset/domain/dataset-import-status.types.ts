import type { DatasetFileType } from './dataset-import-queue.types.js';

export type DatasetImportPipelineStage = 'accepted' | 'normalizing' | 'normalized' | 'queued' | 'error';

export interface DatasetImportPipelineStatus {
  createdAt: string;
  errorMessage: string | null;
  fileName: string;
  id: string;
  normalizedChunks: number | null;
  sizeBytes: number;
  stage: DatasetImportPipelineStage;
  type: DatasetFileType;
  updatedAt: string;
}
