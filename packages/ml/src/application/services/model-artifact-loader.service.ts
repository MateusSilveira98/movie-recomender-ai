import { createHash } from 'node:crypto';
import type { ModelArtifactStorage } from '../ports/model-artifact-storage.port.js';
import {
  MODEL_ARTIFACT_MANIFEST_FILE,
  MODEL_ARTIFACT_METADATA_FILE,
  MODEL_ARTIFACT_MODEL_FILE,
  type ModelArtifactManifest,
  type ModelArtifactTrainingMetadata,
} from '../../domain/models/model-artifact.model.js';
import { getModelArtifactKey, normalizeModelArtifactPrefix, normalizeModelArtifactVersion } from '../../domain/services/model-artifact-path.service.js';
import {
  parseModelArtifactManifest,
  parseModelArtifactTrainingMetadata,
  parseSerializedTensorflowModel,
  type SerializedTensorflowModel,
} from '../../domain/services/model-artifact-validation.service.js';

export interface LoadModelArtifactInput {
  artifactVersion: string;
  storage: ModelArtifactStorage;
  storagePrefix: string;
}

export interface LoadedModelArtifact {
  manifest: ModelArtifactManifest;
  model: SerializedTensorflowModel;
  training: ModelArtifactTrainingMetadata;
  weights: ReadonlyMap<string, Uint8Array>;
}

export async function loadModelArtifact(input: LoadModelArtifactInput): Promise<LoadedModelArtifact> {
  const artifactVersion = normalizeModelArtifactVersion(input.artifactVersion);
  const storagePrefix = normalizeModelArtifactPrefix(input.storagePrefix);
  const manifest = parseModelArtifactManifest(
    parseJson(
      await input.storage.getObject(getModelArtifactKey(storagePrefix, artifactVersion, MODEL_ARTIFACT_MANIFEST_FILE)),
      'manifesto do artefato',
    ),
  );

  if (manifest.artifactVersion !== artifactVersion) {
    throw new Error('A versão declarada no manifesto não corresponde ao modelo solicitado.');
  }

  const files = new Map(
    await Promise.all(
      manifest.files.map(async (file) => {
        const body = await input.storage.getObject(getModelArtifactKey(storagePrefix, artifactVersion, file.name));

        if (body.byteLength !== file.sizeBytes || hash(body) !== file.sha256) {
          throw new Error('O hash de um arquivo do modelo não confere com o manifesto.');
        }

        return [file.name, body] as const;
      }),
    ),
  );
  const training = parseModelArtifactTrainingMetadata(parseJson(requiredFile(files, MODEL_ARTIFACT_METADATA_FILE), 'metadados de treino'));
  const model = parseSerializedTensorflowModel(parseJson(requiredFile(files, MODEL_ARTIFACT_MODEL_FILE), 'modelo TensorFlow'));

  assertMatchingTrainingMetadata(manifest.training, training);
  assertModelWeightsAreAvailable(model, files);

  return { manifest, model, training, weights: files };
}

function assertMatchingTrainingMetadata(manifest: ModelArtifactTrainingMetadata, training: ModelArtifactTrainingMetadata): void {
  if (
    manifest.targetScale !== training.targetScale ||
    manifest.metrics.mae !== training.metrics.mae ||
    manifest.metrics.mse !== training.metrics.mse ||
    manifest.featureNames.some((feature, index) => feature !== training.featureNames[index]) ||
    manifest.featureScales.popularity !== training.featureScales.popularity ||
    manifest.featureScales.ratingCountLog !== training.featureScales.ratingCountLog ||
    manifest.featureScales.ratingStddev !== training.featureScales.ratingStddev ||
    manifest.featureScales.voteAverage !== training.featureScales.voteAverage
  ) {
    throw new Error('Os metadados de treino não correspondem ao manifesto do artefato.');
  }
}

function assertModelWeightsAreAvailable(model: SerializedTensorflowModel, files: ReadonlyMap<string, Uint8Array>): void {
  for (const path of model.weightsManifest.flatMap((group) => group.paths)) {
    if (!files.has(path)) {
      throw new Error('O modelo referencia um arquivo de pesos que não está no manifesto.');
    }
  }
}

function hash(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson(value: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(value));
  } catch {
    throw new Error(`O ${label} do artefato não é um JSON válido.`);
  }
}

function requiredFile(files: ReadonlyMap<string, Uint8Array>, name: string): Uint8Array {
  const file = files.get(name);

  if (!file) {
    throw new Error('O manifesto não contém todos os arquivos obrigatórios do modelo.');
  }

  return file;
}
