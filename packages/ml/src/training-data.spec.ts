import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateRegressionMetrics } from './domain/services/regression-metrics.service.js';
import { ensureMinimumTrainingRecords, prepareTrainingData } from './domain/services/training-data-preparation.service.js';
import { splitTrainingData } from './domain/services/training-data-split.service.js';

const records = [
  { movieId: '1', popularity: 10, ratingAverage: 4, ratingCount: 100, ratingStddev: 0.5, voteAverage: 8 },
  { movieId: '2', popularity: 20, ratingAverage: 3, ratingCount: 25, ratingStddev: 1, voteAverage: 7 },
  { movieId: '3', popularity: 5, ratingAverage: 2.5, ratingCount: 4, ratingStddev: 0.75, voteAverage: 6 },
  { movieId: '4', popularity: 15, ratingAverage: 4.5, ratingCount: 50, ratingStddev: 0.25, voteAverage: 9 },
];

describe('dados de treino', () => {
  it('normaliza os atributos em uma matriz 2D e o alvo na escala de avaliação', () => {
    const data = prepareTrainingData(records);

    assert.equal(data.features.length, 4);
    assert.equal(data.features[0].length, 4);
    assert.deepEqual(data.featureScales, {
      popularity: 20,
      ratingCountLog: Math.log1p(100),
      ratingStddev: 1,
      voteAverage: 10,
    });
    assert.deepEqual(data.labels, [0.8, 0.6, 0.5, 0.9]);
    assert.ok(data.features.flat().every((value) => value >= 0 && value <= 1));
  });

  it('separa validação determinística sem perder exemplos', () => {
    const split = splitTrainingData(records);

    assert.equal(split.train.length, 3);
    assert.equal(split.validation.length, 1);
  });

  it('rejeita conjuntos insuficientes para o treino', () => {
    assert.throws(() => ensureMinimumTrainingRecords(records.slice(0, 3)), /São necessários pelo menos quatro filmes/);
  });

  it('rejeita médias de avaliação fora da escala do modelo', () => {
    assert.throws(() => prepareTrainingData([{ ...records[0], ratingAverage: 5.1 }]), /fora da escala esperada/);
  });

  it('calcula MAE e MSE', () => {
    assert.deepEqual(calculateRegressionMetrics([3, 5], [4, 4]), { mae: 1, mse: 1 });
  });
});
