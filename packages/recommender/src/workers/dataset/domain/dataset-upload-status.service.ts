import type { DatasetImportResult, DatasetUploadStatus } from './dataset-import-queue.types.js';

export function resolveDatasetUploadStatus(result: DatasetImportResult): DatasetUploadStatus {
  if (result.summary.imported === 0 && (result.summary.rejected > 0 || result.summary.waitingDependencies > 0)) {
    return 'error';
  }

  return result.summary.rejected > 0 || result.summary.waitingDependencies > 0 ? 'partial_error' : 'success';
}
