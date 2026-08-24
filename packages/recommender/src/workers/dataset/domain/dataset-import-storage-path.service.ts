const DEFAULT_DATASET_IMPORT_STORAGE_PREFIX = 'dataset-imports';
const PREFIX_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Environment = Readonly<Record<string, string | undefined>>;

export function resolveDatasetImportStoragePrefix(environment: Environment = process.env): string {
  return normalizeDatasetImportStoragePrefix(environment.DATASET_IMPORT_STORAGE_PREFIX ?? DEFAULT_DATASET_IMPORT_STORAGE_PREFIX);
}

export function normalizeDatasetImportStoragePrefix(prefix: string): string {
  const segments = prefix.trim().replace(/^\/+|\/+$/g, '').split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0 || segments.some((segment) => !PREFIX_SEGMENT_PATTERN.test(segment))) {
    throw new Error('DATASET_IMPORT_STORAGE_PREFIX é inválido.');
  }

  return segments.join('/');
}

export function datasetImportUploadObjectKey(prefix: string, uploadId: string, fileName: string): string {
  return `${prefix}/${uploadId}/${fileName}`;
}

export function datasetImportStatusObjectKey(prefix: string, uploadId: string): string {
  return `${prefix}/${uploadId}/status.json`;
}

export function datasetImportNormalizedChunkObjectKey(prefix: string, uploadId: string, sequence: number): string {
  return `${prefix}/normalized/${uploadId}/chunk-${sequence}.jsonl`;
}
