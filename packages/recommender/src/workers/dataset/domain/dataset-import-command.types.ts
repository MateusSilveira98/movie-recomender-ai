import type { DatasetFileType } from './dataset-import-queue.types.js';
import type { DatasetImportChunkInput } from './dataset-import-chunk.types.js';

export interface DatasetImportCommand {
  fileName: string;
  objectKey: string;
  sizeBytes: number;
  type: DatasetFileType;
  uploadId: string;
}

export interface NormalizedDatasetImportCommand extends Omit<DatasetImportCommand, 'objectKey'> {
  completed: boolean;
  chunks: DatasetImportChunkInput[];
  normalizedChunkCount: number;
}
