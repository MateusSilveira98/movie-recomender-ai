import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelArtifactStorage } from '../ports/model-artifact-storage.port.js';
import {
  MODEL_ARTIFACT_MANIFEST_FILE,
  MODEL_ARTIFACT_METADATA_FILE,
  MODEL_ARTIFACT_MODEL_FILE,
  type ModelArtifactManifest,
} from '../../domain/models/model-artifact.model.js';
import { getModelArtifactKey, normalizeModelArtifactPrefix, normalizeModelArtifactVersion } from '../../domain/services/model-artifact-path.service.js';
import { parseModelArtifactTrainingMetadata, parseSerializedTensorflowModel } from '../../domain/services/model-artifact-validation.service.js';

export interface PublishModelArtifactInput {
  artifactDirectory: string;
  artifactVersion: string;
  now: Date;
  storage: ModelArtifactStorage;
  storagePrefix: string;
}

export async function publishModelArtifact(input: PublishModelArtifactInput): Promise<ModelArtifactManifest> {
  const artifactVersion = normalizeModelArtifactVersion(input.artifactVersion);
  const storagePrefix = normalizeModelArtifactPrefix(input.storagePrefix);
  const files = await readArtifactFiles(input.artifactDirectory);
  const manifestKey = getModelArtifactKey(storagePrefix, artifactVersion, MODEL_ARTIFACT_MANIFEST_FILE);

  if (await input.storage.hasObject(manifestKey)) {
    throw new Error('A versão do modelo já foi publicada e não pode ser sobrescrita.');
  }

  const manifest: ModelArtifactManifest = {
    artifactVersion,
    files: files.map(({ body, name }) => ({ name, sha256: hash(body), sizeBytes: body.byteLength })),
    publishedAt: input.now.toISOString(),
    training: parseModelArtifactTrainingMetadata(parseJson(filesByName(files).get(MODEL_ARTIFACT_METADATA_FILE) ?? new Uint8Array(), 'metadados de treino')),
  };

  for (const file of files) {
    await publishArtifactFile(
      input.storage,
      getModelArtifactKey(storagePrefix, artifactVersion, file.name),
      file.body,
      contentType(file.name),
    );
  }

  await input.storage.putObject({
    body: new TextEncoder().encode(JSON.stringify(manifest)),
    contentType: 'application/json',
    ifAbsent: true,
    key: manifestKey,
  });

  return manifest;
}

async function readArtifactFiles(artifactDirectory: string): Promise<ModelArtifactFileContent[]> {
  const model = parseSerializedTensorflowModel(parseJson(await readArtifactFile(artifactDirectory, MODEL_ARTIFACT_MODEL_FILE), 'modelo TensorFlow'));
  const fileNames = [
    MODEL_ARTIFACT_MODEL_FILE,
    MODEL_ARTIFACT_METADATA_FILE,
    ...new Set(model.weightsManifest.flatMap((group) => group.paths)),
  ];

  if (new Set(fileNames).size !== fileNames.length) {
    throw new Error('O modelo usa um nome de arquivo reservado pelo artefato.');
  }

  return Promise.all(
    fileNames.map(async (name) => ({ body: await readArtifactFile(artifactDirectory, name), name })),
  );
}

async function readArtifactFile(artifactDirectory: string, name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(artifactDirectory, name)));
}

async function publishArtifactFile(
  storage: ModelArtifactStorage,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  if (await storage.hasObject(key)) {
    const existing = await storage.getObject(key);

    if (existing.byteLength === body.byteLength && hash(existing) === hash(body)) {
      return;
    }

    throw new Error('Já existe um arquivo diferente para esta versão imutável do modelo.');
  }

  await storage.putObject({ body, contentType, ifAbsent: true, key });
}

function contentType(name: string): string {
  return name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
}

function filesByName(files: readonly ModelArtifactFileContent[]): ReadonlyMap<string, Uint8Array> {
  return new Map(files.map((file) => [file.name, file.body]));
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

interface ModelArtifactFileContent {
  body: Uint8Array;
  name: string;
}
