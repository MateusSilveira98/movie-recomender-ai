import type { PreparedTrainingData, TrainingDataSplit } from '../models/prepared-training-data.model.js';

export function splitTrainingData(data: PreparedTrainingData, validationRatio = 0.25): TrainingDataSplit {
  const validationStart = data.features.length - validationSize(data.features.length, validationRatio);

  return {
    train: sliceTrainingData(data, 0, validationStart),
    validation: sliceTrainingData(data, validationStart),
  };
}

function validationSize(recordCount: number, validationRatio: number): number {
  return Math.max(1, Math.floor(recordCount * validationRatio));
}

function sliceTrainingData(data: PreparedTrainingData, start: number, end?: number): PreparedTrainingData {
  return { ...data, features: data.features.slice(start, end), labels: data.labels.slice(start, end) };
}
