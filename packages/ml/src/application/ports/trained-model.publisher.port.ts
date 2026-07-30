import type { RegressionMetrics, TrainingFeatureScales } from '../../domain/models/prepared-training-data.model.js';
import type { TrainingModel } from './training-model.port.js';

export interface TrainedModelPublisher {
  publish(model: TrainingModel, metadata: TrainedModelMetadata): Promise<string>;
}

export interface TrainedModelMetadata {
  featureNames: readonly string[];
  featureScales: TrainingFeatureScales;
  metrics: RegressionMetrics;
  targetScale: number;
  trainedAt: string;
}
