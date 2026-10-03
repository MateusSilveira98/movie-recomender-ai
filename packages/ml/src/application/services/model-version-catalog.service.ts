import type { ModelVersionRepository } from '../ports/model-version.repository.port.js';
import type { ModelVersion } from '../../domain/models/model-version.model.js';
import { MODEL_ARTIFACT_MANIFEST_FILE } from '../../domain/models/model-artifact.model.js';
import { getModelArtifactKey, normalizeModelArtifactPrefix, normalizeModelArtifactVersion } from '../../domain/services/model-artifact-path.service.js';

export interface RegisterCandidateModelVersionInput {
  artifactVersion: string;
  now: Date;
  sourceCommitSha?: string;
  storagePrefix: string;
  versions: ModelVersionRepository;
  workflowRunId?: string;
}

export async function registerCandidateModelVersion(input: RegisterCandidateModelVersionInput): Promise<ModelVersion> {
  const artifactVersion = normalizeModelArtifactVersion(input.artifactVersion);
  const storagePrefix = normalizeModelArtifactPrefix(input.storagePrefix);

  return input.versions.registerCandidate({
    createdAt: input.now.toISOString(),
    manifestKey: getModelArtifactKey(storagePrefix, artifactVersion, MODEL_ARTIFACT_MANIFEST_FILE),
    sourceCommitSha: optionalValue(input.sourceCommitSha),
    version: artifactVersion,
    workflowRunId: optionalValue(input.workflowRunId),
  });
}

export async function findActiveModelVersion(versions: ModelVersionRepository): Promise<ModelVersion | undefined> {
  return versions.findActive();
}

export async function promoteCandidateModelVersion(
  versions: ModelVersionRepository,
  artifactVersion: string,
  now: Date,
): Promise<void> {
  await versions.promote(normalizeModelArtifactVersion(artifactVersion), now.toISOString());
}

export async function markCandidateModelVersionFailed(
  versions: ModelVersionRepository,
  artifactVersion: string,
  failureReason: string,
): Promise<void> {
  await versions.markFailed(normalizeModelArtifactVersion(artifactVersion), failureReason);
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
