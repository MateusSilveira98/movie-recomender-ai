import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DatasetImportPipelineStatus } from '../../domain/dataset-import-status.types.js';

const STATUS_SUFFIX = '/status.json';

export interface DatasetImportStatusStore {
  get(uploadId: string): Promise<DatasetImportPipelineStatus | null>;
  list(): Promise<DatasetImportPipelineStatus[]>;
  put(status: DatasetImportPipelineStatus): Promise<void>;
}

export function createDatasetImportStatusStore(client: S3Client, bucket: string): DatasetImportStatusStore {
  return { get, list, put };

  async function get(uploadId: string): Promise<DatasetImportPipelineStatus | null> {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: statusKey(uploadId) }));
      if (!response.Body) return null;
      return parseStatus(await response.Body.transformToString());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function list(): Promise<DatasetImportPipelineStatus[]> {
    const statuses: DatasetImportPipelineStatus[] = [];
    let continuationToken: string | undefined;

    do {
      const page = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        Prefix: 'dataset-imports/',
      }));
      const keys = page.Contents?.map((object) => object.Key).filter((key): key is string => Boolean(key?.endsWith(STATUS_SUFFIX))) ?? [];
      const pageStatuses = await Promise.all(keys.map(async (key) => {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return response.Body ? parseStatus(await response.Body.transformToString()) : null;
      }));
      statuses.push(...pageStatuses.filter((status): status is DatasetImportPipelineStatus => status !== null));
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return statuses.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function put(status: DatasetImportPipelineStatus): Promise<void> {
    await client.send(new PutObjectCommand({
      Body: JSON.stringify(status),
      Bucket: bucket,
      ContentType: 'application/json',
      Key: statusKey(status.id),
    }));
  }
}

function statusKey(uploadId: string): string {
  return `dataset-imports/${uploadId}/status.json`;
}

function parseStatus(value: string): DatasetImportPipelineStatus | null {
  try {
    const status: unknown = JSON.parse(value);
    if (!isStatus(status)) return null;
    return status;
  } catch {
    return null;
  }
}

function isStatus(value: unknown): value is DatasetImportPipelineStatus {
  if (typeof value !== 'object' || value === null) return false;
  const status = value as DatasetImportPipelineStatus;
  return typeof status.id === 'string'
    && typeof status.fileName === 'string'
    && typeof status.type === 'string'
    && typeof status.sizeBytes === 'number'
    && typeof status.stage === 'string'
    && typeof status.createdAt === 'string'
    && typeof status.updatedAt === 'string'
    && (typeof status.errorMessage === 'string' || status.errorMessage === null)
    && (typeof status.normalizedChunks === 'number' || status.normalizedChunks === null);
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    && (error.name === 'NoSuchKey' || error.name === 'NotFound');
}
