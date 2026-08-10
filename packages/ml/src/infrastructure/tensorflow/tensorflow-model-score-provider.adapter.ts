import * as tf from '@tensorflow/tfjs';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { LoadedModelArtifact } from '../../application/services/model-artifact-loader.service.js';
import { createModelFeatureVector } from '../../domain/services/training-data-preparation.service.js';

export interface ModelScoreBatch {
  modelVersion: string;
  scores: ReadonlyMap<string, number>;
}

export interface ModelScoreProvider {
  dispose(): void;
  getScores(movies: readonly Movie[]): ModelScoreBatch;
}

export async function createTensorflowModelScoreProvider(artifact: LoadedModelArtifact): Promise<ModelScoreProvider> {
  await tf.ready();

  const model = await tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: artifact.model.modelTopology,
      weightData: concatenateWeightData(artifact),
      weightSpecs: artifact.model.weightsManifest.flatMap((group) => group.weights),
    }),
  );

  try {
    assertInferenceContract(model, artifact.training.featureNames.length);

    return {
      dispose: () => model.dispose(),
      getScores(movies) {
        const candidates = movies.filter(hasModelFeatures);

        if (candidates.length === 0) {
          return { modelVersion: artifact.manifest.artifactVersion, scores: new Map() };
        }

        const input = tf.tensor2d(
          candidates.map((movie) => createModelFeatureVector({
            popularity: movie.popularity,
            ratingCount: movie.modelFeatures.ratingCount,
            ratingStddev: movie.modelFeatures.ratingStddev,
            voteAverage: movie.modelFeatures.voteAverage,
          }, artifact.training.featureScales)),
        );

        try {
          const output = model.predict(input);

          if (Array.isArray(output) || !isTensor(output)) {
            throw new Error('O modelo retornou uma saída incompatível.');
          }

          try {
            const predictions = Array.from(output.dataSync());

            if (predictions.length !== candidates.length || predictions.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
              throw new Error('O modelo retornou uma pontuação inválida.');
            }

            return {
              modelVersion: artifact.manifest.artifactVersion,
              scores: new Map(candidates.map((movie, index) => [movie.id, predictions[index] ?? 0])),
            };
          } finally {
            output.dispose();
          }
        } finally {
          input.dispose();
        }
      },
    };
  } catch (error) {
    model.dispose();
    throw error;
  }
}

function assertInferenceContract(model: tf.LayersModel, featureCount: number): void {
  const input = tf.zeros([1, featureCount]);

  try {
    const output = model.predict(input);

    if (Array.isArray(output) || !isTensor(output)) {
      throw new Error('O modelo retornou uma saída incompatível.');
    }

    try {
      const predictions = Array.from(output.dataSync());

      if (predictions.length !== 1 || predictions.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
        throw new Error('O modelo não é compatível com a pontuação normalizada esperada.');
      }
    } finally {
      output.dispose();
    }
  } finally {
    input.dispose();
  }
}

function concatenateWeightData(artifact: LoadedModelArtifact): ArrayBuffer {
  const parts = artifact.model.weightsManifest.flatMap((group) => group.paths.map((path) => {
    const weight = artifact.weights.get(path);

    if (!weight) {
      throw new Error('O arquivo de pesos do modelo não foi carregado.');
    }

    return weight;
  }));
  const data = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    data.set(part, offset);
    offset += part.byteLength;
  }

  return data.buffer;
}

function hasModelFeatures(movie: Movie): movie is Movie & { modelFeatures: NonNullable<Movie['modelFeatures']> } {
  const features = movie.modelFeatures;

  return Boolean(
    features &&
    Number.isFinite(movie.popularity) && movie.popularity >= 0 &&
    Number.isFinite(features.ratingCount) && features.ratingCount > 0 &&
    Number.isFinite(features.ratingStddev) && features.ratingStddev >= 0 &&
    Number.isFinite(features.voteAverage) && features.voteAverage >= 0 && features.voteAverage <= 10,
  );
}

function isTensor(value: unknown): value is tf.Tensor {
  return value instanceof tf.Tensor;
}
