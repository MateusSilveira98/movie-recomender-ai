import { S3Client } from '@aws-sdk/client-s3';
import { resolveSecretEnvironmentValue } from '@pkg/shared/data-access/services/config-services/secret-environment.service';
import {
  createDatasetImportStatusStore,
  resolveDatasetImportStoragePrefix,
  type DatasetImportPipelineStatus,
} from '@pkg/recommender';

export async function findDatasetImportStatus(uploadId: string): Promise<DatasetImportPipelineStatus | null> {
  const store = createStore();
  return store ? store.get(uploadId) : null;
}

export async function listDatasetImportStatuses(): Promise<DatasetImportPipelineStatus[]> {
  const store = createStore();
  return store ? store.list() : [];
}

function createStore() {
  const bucket = process.env.DATASET_IMPORT_STORAGE_BUCKET?.trim();
  const accessKeyId = resolveSecretEnvironmentValue(process.env, 'DATASET_IMPORT_STORAGE_ACCESS_KEY');
  const secretAccessKey = resolveSecretEnvironmentValue(process.env, 'DATASET_IMPORT_STORAGE_SECRET_KEY');
  const endpoint = process.env.DATASET_IMPORT_STORAGE_ENDPOINT?.trim();

  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;

  return createDatasetImportStatusStore(new S3Client({
    credentials: { accessKeyId, secretAccessKey },
    endpoint,
    forcePathStyle: process.env.DATASET_IMPORT_STORAGE_FORCE_PATH_STYLE !== 'false',
    region: process.env.DATASET_IMPORT_STORAGE_REGION ?? 'us-east-1',
  }), bucket, resolveDatasetImportStoragePrefix());
}
