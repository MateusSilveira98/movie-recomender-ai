export interface PreparedTrainingData {
  featureNames: readonly string[];
  featureScales: TrainingFeatureScales;
  features: number[][];
  labels: number[];
  targetScale: number;
}

export interface TrainingFeatureScales {
  popularity: number;
  ratingCountLog: number;
  ratingStddev: number;
  voteAverage: number;
}

export interface TrainingDataSplit {
  train: PreparedTrainingData;
  validation: PreparedTrainingData;
}

export interface RegressionMetrics {
  mae: number;
  mse: number;
}
