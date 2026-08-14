import type { Client } from '@libsql/client';
import type { DatasetImportChunk, DatasetImportChunkInput, DatasetImportChunkStatus } from '../../domain/dataset-import-chunk.types.js';
import type { DatasetFileType } from '../../domain/dataset-import-queue.types.js';

export interface QueuedDatasetImportChunk extends DatasetImportChunk {
  type: DatasetFileType;
}

export async function createDatasetImportChunks(
  client: Client,
  jobId: string,
  chunks: readonly DatasetImportChunkInput[],
): Promise<DatasetImportChunk[]> {
  return (await createDatasetImportChunksWithResult(client, jobId, chunks)).chunks;
}

export async function createDatasetImportChunksWithResult(
  client: Client,
  jobId: string,
  chunks: readonly DatasetImportChunkInput[],
): Promise<{ chunks: DatasetImportChunk[]; createdChunks: DatasetImportChunk[] }> {
  assertChunkSequence(chunks);
  const createdChunks: DatasetImportChunk[] = [];

  for (const chunk of chunks) {
    const existing = await findChunkBySequence(client, jobId, chunk.sequence);
    const persisted = await createDatasetImportChunk(client, jobId, chunk);
    if (!existing) createdChunks.push(persisted);
  }

  return { chunks: await listDatasetImportChunks(client, jobId), createdChunks };
}

export async function createDatasetImportChunk(
  client: Client,
  jobId: string,
  chunk: DatasetImportChunkInput,
): Promise<DatasetImportChunk> {
  assertChunkSequence([chunk]);
  const existing = await findChunkBySequence(client, jobId, chunk.sequence);

  if (existing) {
    if (!hasSameCheckpoint(existing, chunk)) {
      throw new Error(`O chunk ${chunk.sequence} já existe com conteúdo diferente.`);
    }

    return existing;
  }

  await client.execute({
    sql: `INSERT INTO dataset_import_chunks
      (id, job_id, sequence, line_start, line_end, record_count, content_hash, payload_path, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
    args: [crypto.randomUUID(), jobId, chunk.sequence, chunk.lineStart, chunk.lineEnd, chunk.recordCount, chunk.contentHash, chunk.payloadPath],
  });

  const created = await findChunkBySequence(client, jobId, chunk.sequence);

  if (!created) {
    throw new Error(`Não foi possível persistir o chunk ${chunk.sequence}.`);
  }

  return created;
}

export async function listDatasetImportChunks(client: Client, jobId: string): Promise<DatasetImportChunk[]> {
  const result = await client.execute({
    sql: `SELECT id, job_id, sequence, line_start, line_end, record_count, content_hash, payload_path, status, attempt_count,
      error_message, processed_rows, imported_rows, rejected_rows, missing_dependency_rows, created_at, completed_at
      FROM dataset_import_chunks WHERE job_id = ? ORDER BY sequence ASC`,
    args: [jobId],
  });

  return result.rows.map(toDatasetImportChunk);
}

export async function claimNextDatasetImportChunk(client: Client, jobId: string): Promise<DatasetImportChunk | null> {
  const next = await client.execute({
    sql: `SELECT id FROM dataset_import_chunks WHERE job_id = ? AND status = 'queued' ORDER BY sequence ASC LIMIT 1`,
    args: [jobId],
  });
  const chunkId = String(next.rows[0]?.id ?? '');

  if (!chunkId) {
    return null;
  }

  const claimed = await client.execute({
    sql: `UPDATE dataset_import_chunks
      SET status = 'processing', attempt_count = attempt_count + 1, started_at = CURRENT_TIMESTAMP, error_message = NULL
      WHERE id = ? AND status = 'queued'`,
    args: [chunkId],
  });

  return claimed.rowsAffected === 1 ? findChunkById(client, chunkId) : null;
}

export async function claimDatasetImportChunk(client: Client, jobId: string, chunkId: string): Promise<DatasetImportChunk | null> {
  const claimed = await client.execute({
    sql: `UPDATE dataset_import_chunks
      SET status = 'processing', attempt_count = attempt_count + 1, started_at = CURRENT_TIMESTAMP, error_message = NULL
      WHERE id = ? AND job_id = ? AND status = 'queued'`,
    args: [chunkId, jobId],
  });

  return claimed.rowsAffected === 1 ? findChunkById(client, chunkId) : null;
}

export async function requeueDatasetImportChunk(client: Client, chunkId: string, message: string): Promise<void> {
  await client.execute({
    sql: `UPDATE dataset_import_chunks SET status = 'queued', error_message = ?
      WHERE id = ? AND status = 'processing'`,
    args: [message, chunkId],
  });
}

export async function completeDatasetImportChunk(client: Client, chunkId: string, result: ChunkImportResult): Promise<void> {
  await client.execute({
    sql: `UPDATE dataset_import_chunks SET status = 'completed', completed_at = CURRENT_TIMESTAMP, error_message = NULL,
      processed_rows = ?, imported_rows = ?, rejected_rows = ?, missing_dependency_rows = ?
      WHERE id = ? AND status = 'processing'`,
    args: [result.processedRows, result.importedRows, result.rejectedRows, result.missingDependencyRows, chunkId],
  });
}

export async function failDatasetImportChunk(client: Client, chunkId: string, message: string): Promise<void> {
  await client.execute({
    sql: `UPDATE dataset_import_chunks SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ?
      WHERE id = ? AND status IN ('queued', 'processing')`,
    args: [message, chunkId],
  });
}

export async function listQueuedDatasetImportChunks(client: Client): Promise<QueuedDatasetImportChunk[]> {
  const result = await client.execute(`SELECT chunks.id, chunks.job_id, chunks.sequence, chunks.line_start, chunks.line_end,
    chunks.record_count, chunks.content_hash, chunks.payload_path, chunks.status, chunks.attempt_count,
    chunks.error_message, chunks.processed_rows, chunks.imported_rows, chunks.rejected_rows,
    chunks.missing_dependency_rows, chunks.created_at, chunks.completed_at, jobs.file_type
    FROM dataset_import_chunks chunks
    JOIN dataset_import_jobs jobs ON jobs.id = chunks.job_id
    WHERE chunks.status = 'queued' AND jobs.status IN ('queued', 'processing')
    ORDER BY chunks.created_at, chunks.sequence`);

  return result.rows.map((row) => ({
    ...toDatasetImportChunk(row),
    type: String(row.file_type) as DatasetFileType,
  }));
}

async function findChunkBySequence(client: Client, jobId: string, sequence: number): Promise<DatasetImportChunk | null> {
  const result = await client.execute({
    sql: `SELECT id, job_id, sequence, line_start, line_end, record_count, content_hash, payload_path, status, attempt_count,
      error_message, processed_rows, imported_rows, rejected_rows, missing_dependency_rows, created_at, completed_at
      FROM dataset_import_chunks WHERE job_id = ? AND sequence = ?`,
    args: [jobId, sequence],
  });

  return result.rows[0] ? toDatasetImportChunk(result.rows[0]) : null;
}

async function findChunkById(client: Client, chunkId: string): Promise<DatasetImportChunk | null> {
  const result = await client.execute({
    sql: `SELECT id, job_id, sequence, line_start, line_end, record_count, content_hash, payload_path, status, attempt_count,
      error_message, processed_rows, imported_rows, rejected_rows, missing_dependency_rows, created_at, completed_at FROM dataset_import_chunks WHERE id = ?`,
    args: [chunkId],
  });

  return result.rows[0] ? toDatasetImportChunk(result.rows[0]) : null;
}

function assertChunkSequence(chunks: readonly DatasetImportChunkInput[]): void {
  const sequences = new Set<number>();

  for (const chunk of chunks) {
    if (chunk.sequence < 0 || !Number.isInteger(chunk.sequence) || sequences.has(chunk.sequence)) {
      throw new Error('Os chunks devem ter sequências inteiras, não negativas e sem repetição.');
    }

    sequences.add(chunk.sequence);
  }
}

function hasSameCheckpoint(existing: DatasetImportChunk, chunk: DatasetImportChunkInput): boolean {
  return existing.contentHash === chunk.contentHash
    && existing.lineStart === chunk.lineStart
    && existing.lineEnd === chunk.lineEnd
    && existing.payloadPath === chunk.payloadPath
    && existing.recordCount === chunk.recordCount;
}

function toDatasetImportChunk(row: Record<string, unknown>): DatasetImportChunk {
  return {
    attemptCount: Number(row.attempt_count),
    completedAt: toNullableString(row.completed_at),
    contentHash: String(row.content_hash),
    createdAt: String(row.created_at),
    errorMessage: toNullableString(row.error_message),
    id: String(row.id),
    importedRows: Number(row.imported_rows),
    jobId: String(row.job_id),
    lineEnd: Number(row.line_end),
    lineStart: Number(row.line_start),
    missingDependencyRows: Number(row.missing_dependency_rows),
    payloadPath: String(row.payload_path),
    recordCount: Number(row.record_count),
    processedRows: Number(row.processed_rows),
    rejectedRows: Number(row.rejected_rows),
    sequence: Number(row.sequence),
    status: String(row.status) as DatasetImportChunkStatus,
  };
}

export interface ChunkImportResult {
  importedRows: number;
  missingDependencyRows: number;
  processedRows: number;
  rejectedRows: number;
}

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
