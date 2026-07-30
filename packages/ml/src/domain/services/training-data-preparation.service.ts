import type { MovieTrainingRecord } from '../models/movie-training-record.model.js';
import type { PreparedTrainingData, TrainingFeatureScales } from '../models/prepared-training-data.model.js';

const FEATURE_NAMES = ['ratingCountLog', 'ratingStddev', 'popularity', 'voteAverage'] as const;
const RATING_SCALE = 5;
const MINIMUM_TRAINING_RECORDS = 4;

export function prepareTrainingData(records: readonly MovieTrainingRecord[]): PreparedTrainingData {
  ensureMinimumRecords(records);
  const scales = createFeatureScales(records);

  return {
    featureNames: FEATURE_NAMES,
    featureScales: scales,
    features: records.map((record) => createFeatureVector(record, scales)),
    labels: records.map((record) => normalize(record.ratingAverage, RATING_SCALE)),
    targetScale: RATING_SCALE,
  };
}

function ensureMinimumRecords(records: readonly MovieTrainingRecord[]): void {
  if (records.length < MINIMUM_TRAINING_RECORDS) {
    throw new Error('São necessários pelo menos quatro filmes com estatísticas de avaliações para treinar o modelo.');
  }
}

function createFeatureScales(records: readonly MovieTrainingRecord[]): TrainingFeatureScales {
  return {
    popularity: maximum(records.map((record) => record.popularity)),
    ratingCountLog: maximum(records.map((record) => Math.log1p(record.ratingCount))),
    ratingStddev: maximum(records.map((record) => record.ratingStddev)),
    voteAverage: 10,
  };
}

function createFeatureVector(record: MovieTrainingRecord, scales: TrainingFeatureScales): number[] {
  return [
    normalize(Math.log1p(record.ratingCount), scales.ratingCountLog),
    normalize(record.ratingStddev, scales.ratingStddev),
    normalize(record.popularity, scales.popularity),
    normalize(record.voteAverage, scales.voteAverage),
  ];
}

function maximum(values: readonly number[]): number {
  return Math.max(...values, 1);
}

function normalize(value: number, scale: number): number {
  return Math.max(0, value) / scale;
}
