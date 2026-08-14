import type { RegressionMetrics, TrainingFeatureScales } from './prepared-training-data.model.js';

export const MODEL_ARTIFACT_MANIFEST_FILE = 'manifest.json';
export const MODEL_ARTIFACT_MODEL_FILE = 'model.json';
export const MODEL_ARTIFACT_METADATA_FILE = 'training-metadata.json';

export interface ModelArtifactFile {
  name: string;
  sha256: string;
  sizeBytes: number;
}

export interface ModelArtifactManifest {
  artifactVersion: string;
  files: ModelArtifactFile[];
  publishedAt: string;
  training: ModelArtifactTrainingMetadata;
}

export interface ModelArtifactTrainingMetadata {
  featureNames: string[];
  featureScales: TrainingFeatureScales;
  metrics: RegressionMetrics;
  targetScale: number;
}
