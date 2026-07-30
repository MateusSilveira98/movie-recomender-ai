import type { RegressionMetrics } from '../models/prepared-training-data.model.js';

export function calculateRegressionMetrics(predictions: readonly number[], labels: readonly number[]): RegressionMetrics {
  ensureComparableValues(predictions, labels);
  const errors = predictions.map((prediction, index) => prediction - labels[index]);

  return {
    mae: errors.reduce((total, error) => total + Math.abs(error), 0) / errors.length,
    mse: errors.reduce((total, error) => total + error ** 2, 0) / errors.length,
  };
}

function ensureComparableValues(predictions: readonly number[], labels: readonly number[]): void {
  if (predictions.length === 0 || predictions.length !== labels.length) {
    throw new Error('As previsões e os rótulos precisam ter o mesmo tamanho e não podem estar vazios.');
  }
}
