import {
  createDisabledModelRuntime,
  createFallbackModelRuntime,
  loadModelRuntime,
  type ModelRuntime,
} from '../../application/services/model-runtime.service.js';
import { getModelStorageConfiguration } from '../config/model-storage-configuration.service.js';
import { createS3ModelArtifactStorage } from '../persistence/s3-model-artifact-storage.adapter.js';
import { createTensorflowModelScoreProvider } from '../tensorflow/tensorflow-model-score-provider.adapter.js';

type Environment = Readonly<Record<string, string | undefined>>;

const tensorflowModelScoreProviderFactory = {
  create: createTensorflowModelScoreProvider,
};

export async function loadModelRuntimeFromEnvironment(environment: Environment = process.env): Promise<ModelRuntime> {
  try {
    const configuration = getModelStorageConfiguration(environment);

    if (!configuration) {
      return createDisabledModelRuntime();
    }

    return loadModelRuntime({
      artifactVersion: configuration.artifactVersion,
      modelScoreProviderFactory: tensorflowModelScoreProviderFactory,
      storage: createS3ModelArtifactStorage(configuration),
      storagePrefix: configuration.prefix,
    });
  } catch {
    return createFallbackModelRuntime();
  }
}
