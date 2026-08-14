import type { DatasetFileType } from '../../domain/dataset-import-queue.types.js';

export interface DatasetImportChunkMessage {
  chunkId: string;
  jobId: string;
  type: DatasetFileType;
}

export interface DatasetImportChunkDispatcher {
  publish(message: DatasetImportChunkMessage): Promise<void>;
  publishMany?(messages: readonly DatasetImportChunkMessage[]): Promise<void>;
}
