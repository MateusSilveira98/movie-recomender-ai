import type { Client } from '@libsql/client';
import type { ModelVersionRepository } from '../../application/ports/model-version.repository.port.js';
import type { ModelVersion, ModelVersionStatus, RegisterModelVersionCandidateInput } from '../../domain/models/model-version.model.js';
import { assertModelVersionTransition } from '../../domain/services/model-version-status.service.js';
import { normalizeModelArtifactVersion } from '../../domain/services/model-artifact-path.service.js';

export function createLibsqlModelVersionRepository(client: Client): ModelVersionRepository {
  return {
    findActive: () => findActiveModelVersion(client),
    findByVersion: (version) => findModelVersion(client, version),
    markFailed: (version, failureReason) => markModelVersionFailed(client, version, failureReason),
    promote: (version, activatedAt) => promoteModelVersion(client, version, activatedAt),
    registerCandidate: (input) => registerModelVersionCandidate(client, input),
  };
}

async function findActiveModelVersion(client: Client): Promise<ModelVersion | undefined> {
  const result = await client.execute({
    sql: `SELECT version, manifest_key AS manifestKey, status, source_commit_sha AS sourceCommitSha,
      workflow_run_id AS workflowRunId, created_at AS createdAt, activated_at AS activatedAt,
      failure_reason AS failureReason
      FROM model_versions WHERE status = 'active' LIMIT 1`,
    args: [],
  });

  return result.rows[0] ? toModelVersion(result.rows[0] as Record<string, unknown>) : undefined;
}

async function findModelVersion(client: Client, version: string): Promise<ModelVersion | undefined> {
  const result = await client.execute({
    sql: `SELECT version, manifest_key AS manifestKey, status, source_commit_sha AS sourceCommitSha,
      workflow_run_id AS workflowRunId, created_at AS createdAt, activated_at AS activatedAt,
      failure_reason AS failureReason
      FROM model_versions WHERE version = ? LIMIT 1`,
    args: [normalizeModelArtifactVersion(version)],
  });

  return result.rows[0] ? toModelVersion(result.rows[0] as Record<string, unknown>) : undefined;
}

async function registerModelVersionCandidate(client: Client, input: RegisterModelVersionCandidateInput): Promise<ModelVersion> {
  const version = normalizeModelArtifactVersion(input.version);
  const existing = await findModelVersion(client, version);

  if (existing) {
    throw new Error('A versão do modelo já foi registrada e não pode ser sobrescrita.');
  }

  await client.execute({
    sql: `INSERT INTO model_versions (
      version, manifest_key, status, source_commit_sha, workflow_run_id, created_at
    ) VALUES (?, ?, 'candidate', ?, ?, ?)`,
    args: [
      version,
      input.manifestKey,
      input.sourceCommitSha ?? null,
      input.workflowRunId ?? null,
      input.createdAt,
    ],
  });

  return {
    createdAt: input.createdAt,
    manifestKey: input.manifestKey,
    sourceCommitSha: input.sourceCommitSha,
    status: 'candidate',
    version,
    workflowRunId: input.workflowRunId,
  };
}

async function promoteModelVersion(client: Client, version: string, activatedAt: string): Promise<void> {
  const normalizedVersion = normalizeModelArtifactVersion(version);
  const candidate = await findModelVersion(client, normalizedVersion);

  if (!candidate) {
    throw new Error('A versão candidata do modelo não foi encontrada.');
  }

  assertModelVersionTransition(candidate.status, 'active');

  const active = await findActiveModelVersion(client);

  if (active) {
    assertModelVersionTransition(active.status, 'archived');
  }

  await client.batch(
    [
      {
        sql: `UPDATE model_versions SET status = 'archived' WHERE status = 'active' AND version != ?`,
        args: [normalizedVersion],
      },
      {
        sql: `UPDATE model_versions
          SET status = 'active', activated_at = ?, failure_reason = NULL
          WHERE version = ? AND status = 'candidate'`,
        args: [activatedAt, normalizedVersion],
      },
    ],
    'write',
  );

  const promoted = await findModelVersion(client, normalizedVersion);

  if (!promoted || promoted.status !== 'active') {
    throw new Error('Não foi possível promover a versão candidata do modelo.');
  }
}

async function markModelVersionFailed(client: Client, version: string, failureReason: string): Promise<void> {
  const normalizedVersion = normalizeModelArtifactVersion(version);
  const candidate = await findModelVersion(client, normalizedVersion);

  if (!candidate) {
    throw new Error('A versão candidata do modelo não foi encontrada.');
  }

  assertModelVersionTransition(candidate.status, 'failed');

  const reason = failureReason.trim();

  if (!reason) {
    throw new Error('O motivo da falha da versão do modelo é obrigatório.');
  }

  await client.execute({
    sql: `UPDATE model_versions
      SET status = 'failed', failure_reason = ?
      WHERE version = ? AND status = 'candidate'`,
    args: [reason.slice(0, 500), normalizedVersion],
  });

  const failed = await findModelVersion(client, normalizedVersion);

  if (!failed || failed.status !== 'failed') {
    throw new Error('Não foi possível marcar a versão candidata do modelo como failed.');
  }
}

function toModelVersion(row: Record<string, unknown>): ModelVersion {
  return {
    activatedAt: optionalString(row.activatedAt),
    createdAt: String(row.createdAt),
    failureReason: optionalString(row.failureReason),
    manifestKey: String(row.manifestKey),
    sourceCommitSha: optionalString(row.sourceCommitSha),
    status: parseStatus(row.status),
    version: String(row.version),
    workflowRunId: optionalString(row.workflowRunId),
  };
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value);

  return normalized.length > 0 ? normalized : undefined;
}

function parseStatus(value: unknown): ModelVersionStatus {
  const status = String(value);

  if (status === 'candidate' || status === 'active' || status === 'failed' || status === 'archived') {
    return status;
  }

  throw new Error('O status da versão do modelo é inválido.');
}
