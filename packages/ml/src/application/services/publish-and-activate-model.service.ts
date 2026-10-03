import type { ModelArtifactStorage } from '../ports/model-artifact-storage.port.js';
import type { ModelScoreProviderFactory } from '../ports/model-score-provider-factory.port.js';
import type { ModelVersionRepository } from '../ports/model-version.repository.port.js';
import { publishModelArtifact } from './model-artifact-publisher.service.js';
import { loadModelArtifact } from './model-artifact-loader.service.js';
import {
  markCandidateModelVersionFailed,
  promoteCandidateModelVersion,
  registerCandidateModelVersion,
} from './model-version-catalog.service.js';
import { normalizeModelArtifactVersion } from '../../domain/services/model-artifact-path.service.js';

export interface PublishAndActivateModelInput {
  artifactDirectory: string;
  artifactVersion: string;
  modelScoreProviderFactory: ModelScoreProviderFactory;
  now: Date;
  sourceCommitSha?: string;
  storage: ModelArtifactStorage;
  storagePrefix: string;
  versions: ModelVersionRepository;
  workflowRunId?: string;
}

export interface PublishAndActivateModelResult {
  artifactVersion: string;
  status: 'active';
}

export async function publishAndActivateModel(input: PublishAndActivateModelInput): Promise<PublishAndActivateModelResult> {
  const artifactVersion = normalizeModelArtifactVersion(input.artifactVersion);

  await publishModelArtifact({
    artifactDirectory: input.artifactDirectory,
    artifactVersion,
    now: input.now,
    storage: input.storage,
    storagePrefix: input.storagePrefix,
  });

  await registerCandidateModelVersion({
    artifactVersion,
    now: input.now,
    sourceCommitSha: input.sourceCommitSha,
    storagePrefix: input.storagePrefix,
    versions: input.versions,
    workflowRunId: input.workflowRunId,
  });

  try {
    await validatePublishedArtifact(input, artifactVersion);
    await promoteCandidateModelVersion(input.versions, artifactVersion, input.now);
  } catch (error) {
    await markCandidateModelVersionFailed(input.versions, artifactVersion, toFailureReason(error));
    throw error;
  }

  return { artifactVersion, status: 'active' };
}

async function validatePublishedArtifact(input: PublishAndActivateModelInput, artifactVersion: string): Promise<void> {
  const artifact = await loadModelArtifact({
    artifactVersion,
    storage: input.storage,
    storagePrefix: input.storagePrefix,
  });
  const provider = await input.modelScoreProviderFactory.create(artifact);

  try {
    provider.dispose();
  } catch {
    // dispose failures must not hide a successful validation
  }
}

function toFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Falha ao validar o artefato publicado.';
}
