import { normalizeModelArtifactVersion } from './model-artifact-path.service.js';

export interface BuildModelArtifactVersionInput {
  commitSha: string;
  date: Date;
  workflowRunId: string;
}

export function buildModelArtifactVersion(input: BuildModelArtifactVersionInput): string {
  const date = formatUtcDate(input.date);
  const commitSha = normalizeCommitSha(input.commitSha);
  const workflowRunId = normalizeWorkflowRunId(input.workflowRunId);

  return normalizeModelArtifactVersion(`model-${date}-${commitSha}-${workflowRunId}`);
}

function formatUtcDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('A data da versão do modelo é inválida.');
  }

  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function normalizeCommitSha(commitSha: string): string {
  const normalized = commitSha.trim().toLowerCase();

  if (!/^[0-9a-f]{7,40}$/.test(normalized)) {
    throw new Error('O commit SHA da versão do modelo é inválido.');
  }

  return normalized.slice(0, 7);
}

function normalizeWorkflowRunId(workflowRunId: string): string {
  const normalized = workflowRunId.trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(normalized)) {
    throw new Error('O workflow run id da versão do modelo é inválido.');
  }

  return normalized;
}
