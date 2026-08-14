import type { ModelArtifactStorage } from '../ports/model-artifact-storage.port.js';
import { loadModelArtifact } from './model-artifact-loader.service.js';
import type { ModelScoreProvider } from '@pkg/recommender';
import type { ModelScoreProviderFactory } from '../ports/model-score-provider-factory.port.js';

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
  modelScoreProviderFactory: ModelScoreProviderFactory;
  storage: ModelArtifactStorage;
  storagePrefix: string;
}

export async function loadModelRuntime(input: LoadModelRuntimeInput): Promise<ModelRuntime> {
  try {
    const artifact = await loadModelArtifact(input);
    const modelScoreProvider = await input.modelScoreProviderFactory.create(artifact);

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

export function getTrainingPipelineStatus(): ModelRuntimeStatus {
  return disabledRuntime().status;
}

export function createDisabledModelRuntime(): ModelRuntime {
  return disabledRuntime();
}

export function createFallbackModelRuntime(): ModelRuntime {
  return fallbackRuntime();
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
