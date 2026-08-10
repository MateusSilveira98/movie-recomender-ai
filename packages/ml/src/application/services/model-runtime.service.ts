import type { ModelArtifactStorage } from '../ports/model-artifact-storage.port.js';
import { loadModelArtifact } from './model-artifact-loader.service.js';
import { getModelStorageConfiguration } from '../../infrastructure/config/model-storage-configuration.service.js';
import { createS3ModelArtifactStorage } from '../../infrastructure/persistence/s3-model-artifact-storage.adapter.js';
import { createTensorflowModelScoreProvider, type ModelScoreProvider } from '../../infrastructure/tensorflow/tensorflow-model-score-provider.adapter.js';

export interface ModelRuntime {
  dispose(): void;
  modelScoreProvider?: ModelScoreProvider;
  status: ModelRuntimeStatus;
}

export interface ModelRuntimeStatus {
  framework: 'tensorflow-js';
  mode: 'disabled' | 'fallback' | 'inference';
  modelVersion?: string;
  status: 'fallback' | 'loaded' | 'not-configured';
}

export interface LoadModelRuntimeInput {
  artifactVersion: string;
  storage: ModelArtifactStorage;
  storagePrefix: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

export async function loadModelRuntime(input: LoadModelRuntimeInput): Promise<ModelRuntime> {
  try {
    const artifact = await loadModelArtifact(input);
    const modelScoreProvider = await createTensorflowModelScoreProvider(artifact);

    return {
      dispose: () => modelScoreProvider.dispose(),
      modelScoreProvider,
      status: {
        framework: 'tensorflow-js',
        mode: 'inference',
        modelVersion: artifact.manifest.artifactVersion,
        status: 'loaded',
      },
    };
  } catch {
    return fallbackRuntime();
  }
}

export async function loadModelRuntimeFromEnvironment(environment: Environment = process.env): Promise<ModelRuntime> {
  try {
    const configuration = getModelStorageConfiguration(environment);

    if (!configuration) {
      return disabledRuntime();
    }

    return loadModelRuntime({
      artifactVersion: configuration.artifactVersion,
      storage: createS3ModelArtifactStorage(configuration),
      storagePrefix: configuration.prefix,
    });
  } catch {
    return fallbackRuntime();
  }
}

export function getTrainingPipelineStatus(): ModelRuntimeStatus {
  return disabledRuntime().status;
}

function disabledRuntime(): ModelRuntime {
  return {
    dispose: () => undefined,
    status: { framework: 'tensorflow-js', mode: 'disabled', status: 'not-configured' },
  };
}

function fallbackRuntime(): ModelRuntime {
  return {
    dispose: () => undefined,
    status: { framework: 'tensorflow-js', mode: 'fallback', status: 'fallback' },
  };
}
