import { createDatabaseClient } from '@pkg/database';
import type { ModelArtifactStorage } from '../../application/ports/model-artifact-storage.port.js';
import type { ModelVersionRepository } from '../../application/ports/model-version.repository.port.js';
import {
  createDisabledModelRuntime,
  createFallbackModelRuntime,
  loadModelRuntime,
  type ModelRuntime,
} from '../../application/services/model-runtime.service.js';
import { findActiveModelVersion } from '../../application/services/model-version-catalog.service.js';
import {
  getModelStorageConfiguration,
  resolveConfiguredModelVersion,
  type ModelStorageConfiguration,
} from '../config/model-storage-configuration.service.js';
import { createLibsqlModelVersionRepository } from '../persistence/libsql-model-version.repository.js';
import { createS3ModelArtifactStorage } from '../persistence/s3-model-artifact-storage.adapter.js';
import { createTensorflowModelScoreProvider } from '../tensorflow/tensorflow-model-score-provider.adapter.js';

type Environment = Readonly<Record<string, string | undefined>>;

const tensorflowModelScoreProviderFactory = {
  create: createTensorflowModelScoreProvider,
};

export interface LoadModelRuntimeFromEnvironmentDependencies {
  createStorage?: (configuration: ModelStorageConfiguration) => ModelArtifactStorage;
  versions?: ModelVersionRepository;
}

export async function loadModelRuntimeFromEnvironment(
  environment: Environment = process.env,
  dependencies: LoadModelRuntimeFromEnvironmentDependencies = {},
): Promise<ModelRuntime> {
  try {
    const configuration = getModelStorageConfiguration(environment);

    if (!configuration) {
      return createDisabledModelRuntime();
    }

    const artifactVersion = await resolveRuntimeArtifactVersion(environment, dependencies.versions);

    if (!artifactVersion) {
      return createFallbackModelRuntime();
    }

    const storage = dependencies.createStorage?.(configuration) ?? createS3ModelArtifactStorage(configuration);

    return loadModelRuntime({
      artifactVersion,
      modelScoreProviderFactory: tensorflowModelScoreProviderFactory,
      storage,
      storagePrefix: configuration.prefix,
    });
  } catch {
    return createFallbackModelRuntime();
  }
}

export async function resolveRuntimeArtifactVersion(
  environment: Environment,
  versions?: ModelVersionRepository,
): Promise<string | undefined> {
  const configured = resolveConfiguredModelVersion(environment);

  if (configured) {
    return configured;
  }

  if (versions) {
    return (await findActiveModelVersion(versions))?.version;
  }

  const client = createDatabaseClient();

  try {
    const active = await findActiveModelVersion(createLibsqlModelVersionRepository(client));
    return active?.version;
  } finally {
    await client.close();
  }
}
