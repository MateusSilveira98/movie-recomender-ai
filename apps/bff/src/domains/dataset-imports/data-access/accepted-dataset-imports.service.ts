import type { DatasetFileType } from '@pkg/recommender';

export interface AcceptedDatasetImport {
  fileName: string;
  id: string;
  sizeBytes: number;
  status: 'accepted';
  type: DatasetFileType;
}

const acceptedImports = new Map<string, AcceptedDatasetImport>();

export function rememberAcceptedDatasetImport(imported: AcceptedDatasetImport): void {
  acceptedImports.set(imported.id, imported);
}

export function findAcceptedDatasetImport(uploadId: string): AcceptedDatasetImport | null {
  return acceptedImports.get(uploadId) ?? null;
}
