import type { Client } from '@libsql/client';
import type {
  DatasetDependency,
  DatasetFailure,
  DatasetFileType,
  DatasetImportJob,
  DatasetImportJobStatus,
  DatasetImportResult,
  DatasetUpload,
  DatasetUploadInput,
  DatasetUploadStatus,
} from '../../domain/dataset-import-queue.types.js';
import { resolveDatasetUploadStatus } from '../../domain/dataset-upload-status.service.js';

export interface StoredDatasetImportJob extends DatasetImportJob {
  storagePath: string | null;
}

export async function createDatasetUploadWithJob(client: Client, upload: DatasetUploadInput): Promise<DatasetUpload> {
  const uploadId = crypto.randomUUID();
  const jobId = crypto.randomUUID();

  await client.batch([
    {
      sql: `INSERT INTO dataset_uploads (id, file_name, file_type, storage_path, size_bytes, status)
        VALUES (?, ?, ?, ?, ?, 'queued')`,
      args: [uploadId, upload.fileName, upload.type, upload.storagePath, upload.sizeBytes],
    },
    {
      sql: `INSERT INTO dataset_import_jobs (id, upload_id, file_type, status)
        VALUES (?, ?, ?, 'queued')`,
      args: [jobId, uploadId, upload.type],
    },
  ], 'write');

  return {
    completedAt: null,
    createdAt: new Date().toISOString(),
    dependencies: [],
    errorMessage: null,
    failures: [],
    fileName: upload.fileName,
    id: uploadId,
    jobId,
    sizeBytes: upload.sizeBytes,
    status: 'queued',
    summary: emptySummary(),
    type: upload.type,
  };
}

export async function claimNextDatasetImportJob(client: Client): Promise<StoredDatasetImportJob | null> {
  const next = await client.execute(`SELECT id FROM dataset_import_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`);
  const jobId = String(next.rows[0]?.id ?? '');

  if (!jobId) {
    return null;
  }

  const claim = await client.execute({
    sql: `UPDATE OR IGNORE dataset_import_jobs
      SET status = 'processing', attempt_count = attempt_count + 1, started_at = CURRENT_TIMESTAMP, error_message = NULL
      WHERE id = ? AND status = 'queued'`,
    args: [jobId],
  });

  if (claim.rowsAffected !== 1) {
    return null;
  }

  await client.execute({
    sql: `UPDATE dataset_uploads SET status = 'processing', updated_at = CURRENT_TIMESTAMP, error_message = NULL
      WHERE id = (SELECT upload_id FROM dataset_import_jobs WHERE id = ?)`,
    args: [jobId],
  });

  return findStoredJob(client, jobId);
}

export async function completeDatasetImportJob(client: Client, job: StoredDatasetImportJob, result: DatasetImportResult): Promise<void> {
  const status = resolveDatasetUploadStatus(result);

  await client.batch([
    {
      sql: `UPDATE dataset_import_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ?`,
      args: [job.id],
    },
    {
      sql: `UPDATE dataset_uploads
        SET status = ?, processed_rows = ?, imported_rows = ?, rejected_rows = ?, waiting_dependency_rows = ?,
          failures_json = ?, dependencies_json = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP,
          completed_at = CURRENT_TIMESTAMP, storage_path = NULL
        WHERE id = ?`,
      args: [
        status,
        result.summary.processed,
        result.summary.imported,
        result.summary.rejected,
        result.summary.waitingDependencies,
        JSON.stringify(result.failures),
        JSON.stringify(result.dependencies),
        job.uploadId,
      ],
    },
  ], 'write');
}

export async function waitForDatasetDependencies(client: Client, job: StoredDatasetImportJob, dependencies: DatasetDependency[]): Promise<void> {
  await client.batch([
    {
      sql: `UPDATE dataset_import_jobs SET status = 'waiting_dependencies', error_message = NULL WHERE id = ?`,
      args: [job.id],
    },
    {
      sql: `UPDATE dataset_uploads
        SET status = 'waiting_dependencies', dependencies_json = ?, updated_at = CURRENT_TIMESTAMP, error_message = NULL
        WHERE id = ?`,
      args: [JSON.stringify(dependencies), job.uploadId],
    },
  ], 'write');
}

export async function failDatasetImportJob(client: Client, job: StoredDatasetImportJob, errorMessage: string, failure: DatasetFailure): Promise<void> {
  await client.batch([
    {
      sql: `UPDATE dataset_import_jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?`,
      args: [errorMessage, job.id],
    },
    {
      sql: `UPDATE dataset_uploads
        SET status = 'error', failures_json = ?, dependencies_json = '[]', error_message = ?, updated_at = CURRENT_TIMESTAMP,
          completed_at = CURRENT_TIMESTAMP, storage_path = NULL
        WHERE id = ?`,
      args: [JSON.stringify([failure]), errorMessage, job.uploadId],
    },
  ], 'write');
}

export async function requeueWaitingDatasetJobs(client: Client, dependency: DatasetDependency['type']): Promise<void> {
  const waiting = await client.execute(`SELECT id, upload_id FROM dataset_import_jobs WHERE status = 'waiting_dependencies'`);

  for (const row of waiting.rows) {
    const jobId = String(row.id);
    const uploadId = String(row.upload_id);
    const upload = await client.execute({ sql: 'SELECT dependencies_json FROM dataset_uploads WHERE id = ?', args: [uploadId] });
    const dependencies = parseDependencies(upload.rows[0]?.dependencies_json);

    if (!dependencies.some((item) => item.type === dependency)) {
      continue;
    }

    await client.batch([
      { sql: `UPDATE dataset_import_jobs SET status = 'queued', error_message = NULL WHERE id = ?`, args: [jobId] },
      {
        sql: `UPDATE dataset_uploads SET status = 'queued', dependencies_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [uploadId],
      },
    ], 'write');
  }
}

export async function listDatasetUploads(client: Client): Promise<DatasetUpload[]> {
  const result = await client.execute(`SELECT uploads.*, jobs.id AS job_id
    FROM dataset_uploads uploads JOIN dataset_import_jobs jobs ON jobs.upload_id = uploads.id
    ORDER BY uploads.created_at DESC`);

  return result.rows.map(toDatasetUpload);
}

export async function findDatasetUpload(client: Client, uploadId: string): Promise<DatasetUpload | null> {
  const result = await client.execute({
    sql: `SELECT uploads.*, jobs.id AS job_id
      FROM dataset_uploads uploads JOIN dataset_import_jobs jobs ON jobs.upload_id = uploads.id WHERE uploads.id = ?`,
    args: [uploadId],
  });

  return result.rows[0] ? toDatasetUpload(result.rows[0]) : null;
}

export async function listDatasetImportJobs(client: Client): Promise<DatasetImportJob[]> {
  const result = await client.execute(`SELECT id, upload_id, file_type, status, attempt_count, error_message, created_at, completed_at
    FROM dataset_import_jobs ORDER BY created_at DESC`);

  return result.rows.map(toDatasetImportJob);
}

export async function countRows(client: Client, tableName: 'dataset_movie_links' | 'movies'): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return Number(result.rows[0]?.count ?? 0);
}

export async function findStoredJob(client: Client, jobId: string): Promise<StoredDatasetImportJob | null> {
  const result = await client.execute({
    sql: `SELECT jobs.id, jobs.upload_id, jobs.file_type, jobs.status, jobs.attempt_count, jobs.error_message,
      jobs.created_at, jobs.completed_at, uploads.storage_path
      FROM dataset_import_jobs jobs JOIN dataset_uploads uploads ON uploads.id = jobs.upload_id WHERE jobs.id = ?`,
    args: [jobId],
  });

  const row = result.rows[0];

  return row
    ? { ...toDatasetImportJob(row), storagePath: row.storage_path === null ? null : String(row.storage_path) }
    : null;
}

function toDatasetUpload(row: Record<string, unknown>): DatasetUpload {
  return {
    completedAt: toNullableString(row.completed_at),
    createdAt: String(row.created_at),
    dependencies: parseDependencies(row.dependencies_json),
    errorMessage: toNullableString(row.error_message),
    failures: parseFailures(row.failures_json),
    fileName: String(row.file_name),
    id: String(row.id),
    jobId: String(row.job_id),
    sizeBytes: Number(row.size_bytes),
    status: String(row.status) as DatasetUploadStatus,
    summary: {
      imported: Number(row.imported_rows),
      processed: Number(row.processed_rows),
      rejected: Number(row.rejected_rows),
      waitingDependencies: Number(row.waiting_dependency_rows),
    },
    type: String(row.file_type) as DatasetFileType,
  };
}

function toDatasetImportJob(row: Record<string, unknown>): DatasetImportJob {
  return {
    attemptCount: Number(row.attempt_count),
    completedAt: toNullableString(row.completed_at),
    createdAt: String(row.created_at),
    errorMessage: toNullableString(row.error_message),
    id: String(row.id),
    status: String(row.status) as DatasetImportJobStatus,
    type: String(row.file_type) as DatasetFileType,
    uploadId: String(row.upload_id),
  };
}

function parseFailures(value: unknown): DatasetFailure[] {
  return parseJsonArray(value).filter(isDatasetFailure);
}

function parseDependencies(value: unknown): DatasetDependency[] {
  return parseJsonArray(value).filter(isDatasetDependency);
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isDatasetFailure(value: unknown): value is DatasetFailure {
  return typeof value === 'object' && value !== null && typeof (value as DatasetFailure).count === 'number' && typeof (value as DatasetFailure).message === 'string' && typeof (value as DatasetFailure).reason === 'string';
}

function isDatasetDependency(value: unknown): value is DatasetDependency {
  return typeof value === 'object' && value !== null && typeof (value as DatasetDependency).reason === 'string' && ((value as DatasetDependency).type === 'movies' || (value as DatasetDependency).type === 'links');
}

function emptySummary() {
  return { imported: 0, processed: 0, rejected: 0, waitingDependencies: 0 };
}

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
