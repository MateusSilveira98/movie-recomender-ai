import type { ModelScoreProvider } from '@pkg/recommender';
import type { LoadedModelArtifact } from '../services/model-artifact-loader.service.js';

export interface RuntimeModelScoreProvider extends ModelScoreProvider {
  dispose(): void;
}

export interface ModelScoreProviderFactory {
  create(artifact: LoadedModelArtifact): Promise<RuntimeModelScoreProvider>;
}
