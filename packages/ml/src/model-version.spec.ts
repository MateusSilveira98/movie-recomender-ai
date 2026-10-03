import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createClient, type Client } from '@libsql/client';
import * as tf from '@tensorflow/tfjs';
import { writeFile } from 'node:fs/promises';
import type { ModelArtifactStorage, ModelArtifactStoragePutInput } from './application/ports/model-artifact-storage.port.js';
import type { ModelVersionRepository } from './application/ports/model-version.repository.port.js';
import type { ModelVersion } from './domain/models/model-version.model.js';
import { publishAndActivateModel } from './application/services/publish-and-activate-model.service.js';
import { loadModelRuntimeFromEnvironment } from './infrastructure/runtime/model-runtime-environment.factory.js';
import { createLibsqlModelVersionRepository } from './infrastructure/persistence/libsql-model-version.repository.js';
import { createTensorflowModelScoreProvider } from './infrastructure/tensorflow/tensorflow-model-score-provider.adapter.js';
import { buildModelArtifactVersion } from './domain/services/model-version-id.service.js';
import { assertModelVersionTransition } from './domain/services/model-version-status.service.js';
import { getModelArtifactKey } from './domain/services/model-artifact-path.service.js';

const ARTIFACT_PREFIX = 'movie-recommender';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('model version catalog', () => {
  it('generates an immutable version from date, commit and workflow run', () => {
    assert.equal(
      buildModelArtifactVersion({
        commitSha: 'abcdef1234567890',
        date: new Date('2026-10-02T12:00:00.000Z'),
        workflowRunId: '12345',
      }),
      'model-20261002-abcdef1-12345',
    );
  });

  it('allows only valid status transitions', () => {
    assert.doesNotThrow(() => assertModelVersionTransition('candidate', 'active'));
    assert.doesNotThrow(() => assertModelVersionTransition('candidate', 'failed'));
    assert.doesNotThrow(() => assertModelVersionTransition('active', 'archived'));
    assert.throws(() => assertModelVersionTransition('failed', 'active'));
    assert.throws(() => assertModelVersionTransition('archived', 'active'));
    assert.throws(() => assertModelVersionTransition('active', 'failed'));
  });

  it('registers a candidate, promotes it and archives the previous active version', async () => {
    const context = await createCatalogContext();

    try {
      await context.versions.registerCandidate({
        createdAt: '2026-10-01T00:00:00.000Z',
        manifestKey: 'movie-recommender/model-v1/manifest.json',
        version: 'model-v1',
      });
      await context.versions.promote('model-v1', '2026-10-01T01:00:00.000Z');

      await context.versions.registerCandidate({
        createdAt: '2026-10-02T00:00:00.000Z',
        manifestKey: 'movie-recommender/model-v2/manifest.json',
        sourceCommitSha: 'abcdef1',
        version: 'model-v2',
        workflowRunId: '99',
      });
      await context.versions.promote('model-v2', '2026-10-02T01:00:00.000Z');

      const active = await context.versions.findActive();
      const previous = await context.versions.findByVersion('model-v1');

      assert.equal(active?.version, 'model-v2');
      assert.equal(active?.status, 'active');
      assert.equal(previous?.status, 'archived');
      assert.equal(await countActiveVersions(context.client), 1);
    } finally {
      await context.client.close();
    }
  });

  it('does not allow overwriting an already registered version', async () => {
    const context = await createCatalogContext();

    try {
      await context.versions.registerCandidate({
        createdAt: '2026-10-01T00:00:00.000Z',
        manifestKey: 'movie-recommender/model-v1/manifest.json',
        version: 'model-v1',
      });

      await assert.rejects(
        () => context.versions.registerCandidate({
          createdAt: '2026-10-02T00:00:00.000Z',
          manifestKey: 'movie-recommender/model-v1/manifest.json',
          version: 'model-v1',
        }),
        /já foi registrada/,
      );
    } finally {
      await context.client.close();
    }
  });

  it('publishes, validates and promotes without changing active when validation fails', async () => {
    const directory = await createArtifactDirectory();
    directories.push(directory);
    const context = await createCatalogContext();
    const storage = new InMemoryModelArtifactStorage();

    try {
      await context.versions.registerCandidate({
        createdAt: '2026-10-01T00:00:00.000Z',
        manifestKey: 'movie-recommender/model-active/manifest.json',
        version: 'model-active',
      });
      await context.versions.promote('model-active', '2026-10-01T01:00:00.000Z');

      await publishAndActivateModel({
        artifactDirectory: directory,
        artifactVersion: 'model-valid',
        modelScoreProviderFactory: { create: createTensorflowModelScoreProvider },
        now: new Date('2026-10-02T12:00:00.000Z'),
        storage,
        storagePrefix: ARTIFACT_PREFIX,
        versions: context.versions,
      });

      assert.equal((await context.versions.findActive())?.version, 'model-valid');
      assert.equal((await context.versions.findByVersion('model-active'))?.status, 'archived');

      await assert.rejects(
        () => publishAndActivateModel({
          artifactDirectory: directory,
          artifactVersion: 'model-invalid',
          modelScoreProviderFactory: { create: createTensorflowModelScoreProvider },
          now: new Date('2026-10-03T12:00:00.000Z'),
          storage: new CorruptingStorage(storage, 'model-invalid'),
          storagePrefix: ARTIFACT_PREFIX,
          versions: context.versions,
        }),
        /hash|TensorFlow|modelo|manifesto|peso/i,
      );

      const active = await context.versions.findActive();
      const failed = await context.versions.findByVersion('model-invalid');

      assert.equal(active?.version, 'model-valid');
      assert.equal(failed?.status, 'failed');
      assert.ok(failed?.failureReason);
    } finally {
      await context.client.close();
    }
  });

  it('uses MODEL_VERSION as an operational override', async () => {
    const { storage, versions } = await publishCatalogActiveArtifact();
    const runtime = await loadModelRuntimeFromEnvironment({
      ...modelStorageEnvironment(),
      MODEL_VERSION: 'catalog-active',
    }, {
      createStorage: () => storage,
      versions,
    });

    try {
      assert.equal(runtime.status.status, 'loaded');
      assert.equal(runtime.status.modelVersion, 'catalog-active');
    } finally {
      runtime.dispose();
    }
  });

  it('falls back when there is no active model version', async () => {
    const runtime = await loadModelRuntimeFromEnvironment(modelStorageEnvironment(), {
      createStorage: () => new InMemoryModelArtifactStorage(),
      versions: new InMemoryModelVersionRepository(),
    });

    assert.equal(runtime.status.status, 'fallback');
  });

  it('falls back when Turso active version lookup fails', async () => {
    const runtime = await loadModelRuntimeFromEnvironment(modelStorageEnvironment(), {
      createStorage: () => new InMemoryModelArtifactStorage(),
      versions: {
        findActive: async () => {
          throw new Error('Turso unavailable');
        },
        findByVersion: async () => undefined,
        markFailed: async () => undefined,
        promote: async () => undefined,
        registerCandidate: async () => {
          throw new Error('unused');
        },
      },
    });

    assert.equal(runtime.status.status, 'fallback');
  });

  it('falls back when the configured model artifact is missing in storage', async () => {
    const runtime = await loadModelRuntimeFromEnvironment({
      ...modelStorageEnvironment(),
      MODEL_VERSION: 'missing-version',
    }, {
      createStorage: () => new InMemoryModelArtifactStorage(),
      versions: new InMemoryModelVersionRepository(),
    });

    assert.equal(runtime.status.status, 'fallback');
  });
});

function modelStorageEnvironment(): Record<string, string> {
  return {
    MODEL_STORAGE_ACCESS_KEY: 'access',
    MODEL_STORAGE_BUCKET: 'models',
    MODEL_STORAGE_ENDPOINT: 'http://localhost:9000',
    MODEL_STORAGE_SECRET_KEY: 'secret',
  };
}

async function publishCatalogActiveArtifact(): Promise<{
  storage: InMemoryModelArtifactStorage;
  versions: InMemoryModelVersionRepository;
}> {
  const directory = await createArtifactDirectory();
  directories.push(directory);
  const storage = new InMemoryModelArtifactStorage();
  const versions = new InMemoryModelVersionRepository();

  await publishAndActivateModel({
    artifactDirectory: directory,
    artifactVersion: 'catalog-active',
    modelScoreProviderFactory: { create: createTensorflowModelScoreProvider },
    now: new Date('2026-10-02T12:00:00.000Z'),
    storage,
    storagePrefix: ARTIFACT_PREFIX,
    versions,
  });

  return { storage, versions };
}

async function createCatalogContext(): Promise<{ client: Client; versions: ModelVersionRepository }> {
  const directory = await mkdtemp(join(tmpdir(), 'model-versions-'));
  directories.push(directory);
  const client = createClient({ url: `file:${join(directory, 'catalog.db')}` });

  await client.executeMultiple(`
    CREATE TABLE model_versions (
      version TEXT PRIMARY KEY,
      manifest_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'failed', 'archived')),
      source_commit_sha TEXT,
      workflow_run_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      activated_at TEXT,
      failure_reason TEXT
    );
    CREATE UNIQUE INDEX idx_model_versions_single_active ON model_versions (status) WHERE status = 'active';
  `);

  return { client, versions: createLibsqlModelVersionRepository(client) };
}

async function countActiveVersions(client: Client): Promise<number> {
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS total FROM model_versions WHERE status = 'active'`,
    args: [],
  });

  return Number(result.rows[0]?.total ?? 0);
}

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

class CorruptingStorage implements ModelArtifactStorage {
  constructor(
    private readonly inner: InMemoryModelArtifactStorage,
    private readonly version: string,
  ) {}

  async getObject(key: string): Promise<Uint8Array> {
    const body = await this.inner.getObject(key);
    const weightsKey = getModelArtifactKey(ARTIFACT_PREFIX, this.version, 'weights.bin');

    if (key === weightsKey) {
      return Uint8Array.of(9, 9, 9);
    }

    return body;
  }

  hasObject(key: string): Promise<boolean> {
    return this.inner.hasObject(key);
  }

  putObject(input: ModelArtifactStoragePutInput): Promise<void> {
    return this.inner.putObject(input);
  }
}

class InMemoryModelVersionRepository implements ModelVersionRepository {
  private readonly versions = new Map<string, ModelVersion>();

  async findActive(): Promise<ModelVersion | undefined> {
    return [...this.versions.values()].find((version) => version.status === 'active');
  }

  async findByVersion(version: string): Promise<ModelVersion | undefined> {
    return this.versions.get(version);
  }

  async markFailed(version: string, failureReason: string): Promise<void> {
    const current = this.versions.get(version);

    if (!current || current.status !== 'candidate') {
      throw new Error('A versão candidata do modelo não foi encontrada.');
    }

    this.versions.set(version, { ...current, failureReason, status: 'failed' });
  }

  async promote(version: string, activatedAt: string): Promise<void> {
    const current = this.versions.get(version);

    if (!current || current.status !== 'candidate') {
      throw new Error('A versão candidata do modelo não foi encontrada.');
    }

    for (const [key, value] of this.versions) {
      if (value.status === 'active') {
        this.versions.set(key, { ...value, status: 'archived' });
      }
    }

    this.versions.set(version, { ...current, activatedAt, status: 'active' });
  }

  async registerCandidate(input: {
    createdAt: string;
    manifestKey: string;
    sourceCommitSha?: string;
    version: string;
    workflowRunId?: string;
  }): Promise<ModelVersion> {
    if (this.versions.has(input.version)) {
      throw new Error('A versão do modelo já foi registrada e não pode ser sobrescrita.');
    }

    const version: ModelVersion = {
      createdAt: input.createdAt,
      manifestKey: input.manifestKey,
      sourceCommitSha: input.sourceCommitSha,
      status: 'candidate',
      version: input.version,
      workflowRunId: input.workflowRunId,
    };

    this.versions.set(input.version, version);
    return version;
  }
}
