import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as tf from '@tensorflow/tfjs';
import { rankRecommendations } from '@pkg/recommender';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { ModelArtifactStorage, ModelArtifactStoragePutInput } from './application/ports/model-artifact-storage.port.js';
import { loadModelRuntime } from './application/services/model-runtime.service.js';
import { publishModelArtifact } from './application/services/model-artifact-publisher.service.js';
import { MODEL_ARTIFACT_MANIFEST_FILE } from './domain/models/model-artifact.model.js';
import { getModelArtifactKey } from './domain/services/model-artifact-path.service.js';
import { createTensorflowModelScoreProvider } from './infrastructure/tensorflow/tensorflow-model-score-provider.adapter.js';

const ARTIFACT_PREFIX = 'movie-recommender';

describe('runtime de inferência do modelo', () => {
  it('deve publicar o manifesto por último e alterar a ordem pelo score do modelo', async () => {
    const directory = await createArtifactDirectory();
    const storage = new InMemoryModelArtifactStorage();

    try {
      const manifest = await publishModelArtifact({
        artifactDirectory: directory,
        artifactVersion: 'local-v1',
        now: new Date('2026-08-10T12:00:00.000Z'),
        storage,
        storagePrefix: ARTIFACT_PREFIX,
      });
      const manifestKey = getModelArtifactKey(ARTIFACT_PREFIX, manifest.artifactVersion, MODEL_ARTIFACT_MANIFEST_FILE);

      assert.equal(storage.writtenKeys.at(-1), manifestKey);

      const runtime = await loadModelRuntime({
        artifactVersion: manifest.artifactVersion,
        modelScoreProviderFactory: { create: createTensorflowModelScoreProvider },
        storage,
        storagePrefix: ARTIFACT_PREFIX,
      });

      try {
        assert.equal(runtime.status.status, 'loaded');
        assert.equal(runtime.status.modelVersion, 'local-v1');
        assert.ok(runtime.modelScoreProvider);
        const readsAfterStartup = storage.readKeys.length;

        const catalog = [
          createMovie({
            id: 'popular',
            modelFeatures: { ratingCount: 1, ratingStddev: 0, voteAverage: 0 },
            popularity: 100,
          }),
          createMovie({
            id: 'quality',
            modelFeatures: { ratingCount: 100, ratingStddev: 1, voteAverage: 10 },
            popularity: 0,
          }),
        ];
        const baseline = rankRecommendations(catalog, emptyPreferences(), emptyHistory());
        const ranked = rankRecommendations(catalog, emptyPreferences(), emptyHistory(), {
          modelScoreProvider: runtime.modelScoreProvider,
        });
        const missingFeatures = runtime.modelScoreProvider.getScores([
          createMovie({ id: 'without-model-features', modelFeatures: undefined, popularity: 100 }),
        ]);

        assert.equal(baseline.recommendations[0]?.id, 'popular');
        assert.equal(ranked.recommendations[0]?.id, 'quality');
        assert.equal(ranked.modelVersion, 'local-v1');
        assert.equal(missingFeatures.scores.size, 0);
        assert.equal(storage.readKeys.length, readsAfterStartup);
      } finally {
        runtime.dispose();
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve manter o fallback quando um peso não confere com o manifesto', async () => {
    const directory = await createArtifactDirectory();
    const storage = new InMemoryModelArtifactStorage();

    try {
      await publishModelArtifact({
        artifactDirectory: directory,
        artifactVersion: 'local-v2',
        now: new Date('2026-08-10T12:00:00.000Z'),
        storage,
        storagePrefix: ARTIFACT_PREFIX,
      });
      storage.replace(getModelArtifactKey(ARTIFACT_PREFIX, 'local-v2', 'weights.bin'), Uint8Array.of(0, 1, 2));

      const runtime = await loadModelRuntime({
        artifactVersion: 'local-v2',
        modelScoreProviderFactory: { create: createTensorflowModelScoreProvider },
        storage,
        storagePrefix: ARTIFACT_PREFIX,
      });

      assert.equal(runtime.status.status, 'fallback');
      assert.equal(runtime.modelScoreProvider, undefined);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve manter o fallback quando o modelo não aceita as features esperadas', async () => {
    const directory = await createArtifactDirectory(3);
    const storage = new InMemoryModelArtifactStorage();

    try {
      await publishModelArtifact({
        artifactDirectory: directory,
        artifactVersion: 'local-v3',
        now: new Date('2026-08-10T12:00:00.000Z'),
        storage,
        storagePrefix: ARTIFACT_PREFIX,
      });

      const runtime = await loadModelRuntime({
        artifactVersion: 'local-v3',
        modelScoreProviderFactory: { create: createTensorflowModelScoreProvider },
        storage,
        storagePrefix: ARTIFACT_PREFIX,
      });

      assert.equal(runtime.status.status, 'fallback');
      assert.equal(runtime.modelScoreProvider, undefined);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve retomar uma publicação parcial apenas quando o arquivo existente confere', async () => {
    const directory = await createArtifactDirectory();
    const storage = new InMemoryModelArtifactStorage();
    const modelKey = getModelArtifactKey(ARTIFACT_PREFIX, 'local-v3', 'model.json');

    try {
      await storage.putObject({
        body: new Uint8Array(await readFile(join(directory, 'model.json'))),
        contentType: 'application/json',
        ifAbsent: true,
        key: modelKey,
      });

      const manifest = await publishModelArtifact({
        artifactDirectory: directory,
        artifactVersion: 'local-v3',
        now: new Date('2026-08-10T12:00:00.000Z'),
        storage,
        storagePrefix: ARTIFACT_PREFIX,
      });

      assert.equal(manifest.artifactVersion, 'local-v3');
      assert.equal(storage.writtenKeys.filter((key) => key === modelKey).length, 1);
      assert.equal(
        storage.writtenKeys.at(-1),
        getModelArtifactKey(ARTIFACT_PREFIX, 'local-v3', MODEL_ARTIFACT_MANIFEST_FILE),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

async function createArtifactDirectory(featureCount = 4): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-model-'));
  const model = tf.sequential();
  model.add(tf.layers.dense({ activation: 'sigmoid', inputShape: [featureCount], units: 1, useBias: false }));
  const weights = tf.tensor2d(Array.from({ length: featureCount }, (_, index) => (index === 0 ? 0 : 1)), [featureCount, 1]);

  try {
    model.setWeights([weights]);
  } finally {
    weights.dispose();
  }

  let artifacts: tf.io.ModelArtifacts | undefined;

  try {
    await model.save(tf.io.withSaveHandler(async (value) => {
      artifacts = value;

      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyBytes: 0,
          modelTopologyType: 'JSON',
          weightDataBytes: value.weightData ? toWeightData(value.weightData).byteLength : 0,
          weightSpecsBytes: 0,
        },
      };
    }));
  } finally {
    model.dispose();
  }

  assert.ok(artifacts?.modelTopology);
  assert.ok(artifacts.weightData);
  assert.ok(artifacts.weightSpecs);

  await Promise.all([
    writeFile(join(directory, 'model.json'), JSON.stringify({
      convertedBy: artifacts.convertedBy,
      format: artifacts.format,
      generatedBy: artifacts.generatedBy,
      modelTopology: artifacts.modelTopology,
      weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }],
    })),
    writeFile(join(directory, 'weights.bin'), toWeightData(artifacts.weightData)),
    writeFile(join(directory, 'training-metadata.json'), JSON.stringify({
      featureNames: ['ratingCountLog', 'ratingStddev', 'popularity', 'voteAverage'],
      featureScales: {
        popularity: 100,
        ratingCountLog: Math.log1p(100),
        ratingStddev: 1,
        voteAverage: 10,
      },
      metrics: { mae: 0.5, mse: 0.4 },
      targetScale: 5,
    })),
  ]);

  return directory;
}

function createMovie(input: Pick<Movie, 'id' | 'modelFeatures' | 'popularity'>): Movie {
  return {
    adult: false,
    description: '',
    genres: [],
    id: input.id,
    modelFeatures: input.modelFeatures,
    popularity: input.popularity,
    runtime: 100,
    title: input.id,
    voteCount: 1,
    year: 2024,
  };
}

function emptyHistory() {
  return { disliked: [], liked: [], watched: [] };
}

function emptyPreferences() {
  return { freeText: '', genres: [], runtime: 'any' as const };
}

function toWeightData(weightData: tf.io.WeightData): Uint8Array {
  const parts = Array.isArray(weightData) ? weightData : [weightData];
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    const value = new Uint8Array(part);
    bytes.set(value, offset);
    offset += value.byteLength;
  }

  return bytes;
}

class InMemoryModelArtifactStorage implements ModelArtifactStorage {
  readonly readKeys: string[] = [];
  readonly writtenKeys: string[] = [];
  private readonly objects = new Map<string, Uint8Array>();

  async getObject(key: string): Promise<Uint8Array> {
    this.readKeys.push(key);
    const object = this.objects.get(key);

    if (!object) {
      throw new Error('Objeto não encontrado.');
    }

    return new Uint8Array(object);
  }

  async hasObject(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async putObject(input: ModelArtifactStoragePutInput): Promise<void> {
    if (input.ifAbsent && this.objects.has(input.key)) {
      throw new Error('Objeto já existe.');
    }

    this.objects.set(input.key, new Uint8Array(input.body));
    this.writtenKeys.push(input.key);
  }

  replace(key: string, body: Uint8Array): void {
    this.objects.set(key, new Uint8Array(body));
  }
}
