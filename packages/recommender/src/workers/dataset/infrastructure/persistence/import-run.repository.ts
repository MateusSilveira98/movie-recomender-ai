import type { Client } from '@libsql/client';
import type { DatasetImportConfiguration } from '../../domain/dataset.types.js';

export type ImportSkipReason = 'completed' | 'running' | null;

export async function findImportSkipReason(client: Client, configuration: DatasetImportConfiguration): Promise<ImportSkipReason> {
  const running = await client.execute({
    sql: `SELECT id FROM dataset_import_runs
      WHERE dataset_key = ? AND environment = ? AND status = 'running'
      ORDER BY started_at DESC LIMIT 1`,
    args: [configuration.datasetKey, configuration.environment],
  });

  if (running.rows[0]) {
    return 'running';
  }

  if (configuration.force) {
    return null;
  }

  const completed = await client.execute({
    sql: `SELECT id FROM dataset_import_runs
      WHERE dataset_key = ? AND dataset_version = ? AND environment = ? AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1`,
    args: [configuration.datasetKey, configuration.datasetVersion, configuration.environment],
  });

  return completed.rows[0] ? 'completed' : null;
}

export async function startImportRun(client: Client, runId: string, configuration: DatasetImportConfiguration): Promise<void> {
  await client.execute({
    sql: `INSERT INTO dataset_import_runs (id, dataset_key, dataset_version, environment, status)
      VALUES (?, ?, ?, ?, 'running')`,
    args: [runId, configuration.datasetKey, configuration.datasetVersion, configuration.environment],
  });
}

export async function completeImportRun(
  client: Client,
  runId: string,
  moviesImported: number,
  featuresImported: number,
  ratingStatsImported: number,
): Promise<void> {
  await client.execute({
    sql: `UPDATE dataset_import_runs
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
        movies_imported = ?, features_imported = ?, rating_stats_imported = ?, error_message = NULL
      WHERE id = ?`,
    args: [moviesImported, featuresImported, ratingStatsImported, runId],
  });
}

export async function failImportRun(client: Client, runId: string, errorMessage: string): Promise<void> {
  await client.execute({
    sql: `UPDATE dataset_import_runs
      SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ?
      WHERE id = ?`,
    args: [errorMessage, runId],
  });
}
