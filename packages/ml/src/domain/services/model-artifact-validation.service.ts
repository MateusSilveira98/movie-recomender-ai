import type { ModelArtifactManifest, ModelArtifactTrainingMetadata } from '../models/model-artifact.model.js';
import { MODEL_ARTIFACT_METADATA_FILE, MODEL_ARTIFACT_MODEL_FILE } from '../models/model-artifact.model.js';
import { normalizeModelArtifactFileName, normalizeModelArtifactVersion } from './model-artifact-path.service.js';

export const MODEL_FEATURE_NAMES = ['ratingCountLog', 'ratingStddev', 'popularity', 'voteAverage'] as const;

export interface SerializedModelWeight {
  dtype: 'bool' | 'complex64' | 'float32' | 'int32' | 'string';
  name: string;
  shape: number[];
}

export interface SerializedTensorflowModel {
  format: 'layers-model';
  modelTopology: Record<string, unknown>;
  weightsManifest: Array<{
    paths: string[];
    weights: SerializedModelWeight[];
  }>;
}

export function parseModelArtifactManifest(value: unknown): ModelArtifactManifest {
  if (!isRecord(value)) {
    throw new Error('O manifesto do artefato é inválido.');
  }

  const artifactVersion = stringValue(value.artifactVersion, 'A versão do artefato é inválida.');
  const files = Array.isArray(value.files) ? value.files.map(parseArtifactFile) : invalidManifest();
  const publishedAt = stringValue(value.publishedAt, 'A data de publicação do artefato é inválida.');

  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new Error('A data de publicação do artefato é inválida.');
  }

  const fileNames = new Set(files.map((file) => file.name));

  if (
    fileNames.size !== files.length ||
    !fileNames.has(MODEL_ARTIFACT_MODEL_FILE) ||
    !fileNames.has(MODEL_ARTIFACT_METADATA_FILE)
  ) {
    throw new Error('Os arquivos do manifesto do artefato são inválidos.');
  }

  return {
    artifactVersion: normalizeModelArtifactVersion(artifactVersion),
    files,
    publishedAt,
    training: parseModelArtifactTrainingMetadata(value.training),
  };
}

export function parseModelArtifactTrainingMetadata(value: unknown): ModelArtifactTrainingMetadata {
  if (!isRecord(value)) {
    throw new Error('Os metadados de treino do artefato são inválidos.');
  }

  const featureNames = Array.isArray(value.featureNames) && value.featureNames.every((name) => typeof name === 'string')
    ? value.featureNames
    : invalidTrainingMetadata();

  if (featureNames.length !== MODEL_FEATURE_NAMES.length || featureNames.some((name, index) => name !== MODEL_FEATURE_NAMES[index])) {
    throw new Error('As features do artefato não são compatíveis com o ranking.');
  }

  if (!isRecord(value.featureScales) || !isRecord(value.metrics)) {
    throw new Error('Os metadados de treino do artefato são inválidos.');
  }

  const featureScales = {
    popularity: positiveNumber(value.featureScales.popularity, 'A escala de popularidade do artefato é inválida.'),
    ratingCountLog: positiveNumber(value.featureScales.ratingCountLog, 'A escala de quantidade de avaliações do artefato é inválida.'),
    ratingStddev: positiveNumber(value.featureScales.ratingStddev, 'A escala de dispersão das avaliações do artefato é inválida.'),
    voteAverage: positiveNumber(value.featureScales.voteAverage, 'A escala de votos do artefato é inválida.'),
  };
  const metrics = {
    mae: nonNegativeNumber(value.metrics.mae, 'A métrica MAE do artefato é inválida.'),
    mse: nonNegativeNumber(value.metrics.mse, 'A métrica MSE do artefato é inválida.'),
  };

  return {
    featureNames: [...featureNames],
    featureScales,
    metrics,
    targetScale: positiveNumber(value.targetScale, 'A escala alvo do artefato é inválida.'),
  };
}

export function parseSerializedTensorflowModel(value: unknown): SerializedTensorflowModel {
  if (!isRecord(value) || value.format !== 'layers-model' || !isRecord(value.modelTopology) || !Array.isArray(value.weightsManifest)) {
    throw new Error('O modelo TensorFlow do artefato é inválido.');
  }

  const weightsManifest = value.weightsManifest.map((group) => {
    if (!isRecord(group) || !Array.isArray(group.paths) || !Array.isArray(group.weights) || group.paths.length === 0 || group.weights.length === 0) {
      throw new Error('Os pesos do modelo TensorFlow são inválidos.');
    }

    return {
      paths: group.paths.map((path) => normalizeModelArtifactFileName(stringValue(path, 'O caminho de peso do modelo é inválido.'))),
      weights: group.weights.map(parseSerializedModelWeight),
    };
  });

  return { format: 'layers-model', modelTopology: value.modelTopology, weightsManifest };
}

function invalidManifest(): never {
  throw new Error('O manifesto do artefato é inválido.');
}

function invalidTrainingMetadata(): never {
  throw new Error('Os metadados de treino do artefato são inválidos.');
}

function parseArtifactFile(value: unknown) {
  if (!isRecord(value)) {
    return invalidManifest();
  }

  const name = normalizeModelArtifactFileName(stringValue(value.name, 'O arquivo do artefato é inválido.'));
  const sha256 = stringValue(value.sha256, 'O hash do arquivo do artefato é inválido.');

  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('O hash do arquivo do artefato é inválido.');
  }

  return {
    name,
    sha256,
    sizeBytes: positiveNumber(value.sizeBytes, 'O tamanho do arquivo do artefato é inválido.'),
  };
}

function parseSerializedModelWeight(value: unknown): SerializedModelWeight {
  if (!isRecord(value) || !Array.isArray(value.shape)) {
    throw new Error('A especificação de peso do modelo é inválida.');
  }

  const dtype = stringValue(value.dtype, 'O tipo de peso do modelo é inválido.');

  if (!isWeightDtype(dtype)) {
    throw new Error('O tipo de peso do modelo é inválido.');
  }

  return {
    dtype,
    name: stringValue(value.name, 'O nome de peso do modelo é inválido.'),
    shape: value.shape.map((dimension) => nonNegativeInteger(dimension, 'A dimensão de peso do modelo é inválida.')),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWeightDtype(value: string): value is SerializedModelWeight['dtype'] {
  return value === 'bool' || value === 'complex64' || value === 'float32' || value === 'int32' || value === 'string';
}

function nonNegativeInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(message);
  }

  return value;
}

function nonNegativeNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(message);
  }

  return value;
}

function positiveNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(message);
  }

  return value;
}

function stringValue(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}
