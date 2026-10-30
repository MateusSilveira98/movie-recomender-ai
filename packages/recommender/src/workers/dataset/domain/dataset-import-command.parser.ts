import { DATASET_FILE_TYPES } from './dataset-import-queue.types.js';
import type { DatasetImportCommand, NormalizedDatasetImportCommand } from './dataset-import-command.types.js';

export function parseDatasetImportCommand(value: unknown): DatasetImportCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const command = value as DatasetImportCommand;
  const localFilePath = typeof command.localFilePath === 'string' && command.localFilePath.length > 0 ? command.localFilePath : undefined;
  const base: DatasetImportCommand = {
    fileName: command.fileName,
    objectKey: command.objectKey,
    sizeBytes: command.sizeBytes,
    type: command.type,
    uploadId: command.uploadId,
  };
  return typeof base.uploadId === 'string' && base.uploadId.length > 0
    && typeof base.objectKey === 'string' && base.objectKey.length > 0
    && typeof base.fileName === 'string' && base.fileName.length > 0
    && typeof base.sizeBytes === 'number' && Number.isSafeInteger(base.sizeBytes) && base.sizeBytes >= 0
    && typeof base.type === 'string' && DATASET_FILE_TYPES.includes(base.type)
    ? localFilePath ? { ...base, localFilePath } : base
    : null;
}

export function assertDatasetImportCommand(command: DatasetImportCommand): void {
  if (!parseDatasetImportCommand(command)) {
    throw new Error('O comando de importação precisa conter metadados válidos.');
  }
}

export function parseNormalizedDatasetImportCommand(value: unknown): NormalizedDatasetImportCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const command = value as NormalizedDatasetImportCommand;
  const completed = command.completed === true;
  return typeof command.uploadId === 'string' && command.uploadId.length > 0
    && typeof command.fileName === 'string' && command.fileName.length > 0
    && typeof command.sizeBytes === 'number' && Number.isSafeInteger(command.sizeBytes) && command.sizeBytes >= 0
    && typeof command.type === 'string' && DATASET_FILE_TYPES.includes(command.type)
    && Array.isArray(command.chunks) && (completed || command.chunks.length > 0)
    && command.chunks.every((chunk) => typeof chunk.payloadPath === 'string' && chunk.payloadPath.length > 0 && typeof chunk.contentHash === 'string' && Number.isInteger(chunk.sequence))
    ? { ...command, completed, normalizedChunkCount: Number.isInteger(command.normalizedChunkCount) ? command.normalizedChunkCount : command.chunks.length }
    : null;
}

export function assertNormalizedDatasetImportCommand(command: NormalizedDatasetImportCommand): void {
  if (!parseNormalizedDatasetImportCommand(command)) {
    throw new Error('O comando normalizado de importação é inválido.');
  }
}

