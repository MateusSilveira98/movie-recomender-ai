import { resolve } from 'node:path';
import { createDatabaseClient } from '@pkg/database';
import { recordFailedOperation, recordTrainingJob, startObservability, stopObservability } from '@pkg/observability';
import { publishAndActivateModel } from './application/services/publish-and-activate-model.service.js';
import { trainModel } from './application/services/train-model.service.js';
import {
  getModelStorageConfiguration,
  resolveTrainingArtifactVersion,
} from './infrastructure/config/model-storage-configuration.service.js';
import { createFileSystemTrainedModelPublisher } from './infrastructure/publishing/file-system-trained-model.publisher.js';
import { createLibsqlModelVersionRepository } from './infrastructure/persistence/libsql-model-version.repository.js';
import { createLibsqlTrainingRecordRepository } from './infrastructure/persistence/libsql-training-record.repository.js';
import { createS3ModelArtifactStorage } from './infrastructure/persistence/s3-model-artifact-storage.adapter.js';
import { createTensorflowModelScoreProvider } from './infrastructure/tensorflow/tensorflow-model-score-provider.adapter.js';
import { createTensorflowTrainingModel } from './infrastructure/tensorflow/tensorflow-training-model.adapter.js';

export interface TrainingJobResult {
  artifactVersion?: string;
  status: 'trained' | 'active';
  modelName: 'movie-recommender-baseline';
  metrics: { mae: number; mse: number };
  modelPath: string;
  trainingRecordCount: number;
}

export async function runTrainingJob(): Promise<TrainingJobResult> {
  const client = createDatabaseClient();
  const modelDirectory = resolve(process.env.TRAINING_MODEL_DIR ?? 'models/movie-recommender-baseline');
  const storageConfiguration = getModelStorageConfiguration(process.env);
  const now = new Date();
  const artifactVersion = resolveTrainingArtifactVersion(process.env, now);

  try {
    const result = await trainModel({
      clock: () => now,
      model: createTensorflowTrainingModel(),
      publisher: createFileSystemTrainedModelPublisher(modelDirectory),
      records: createLibsqlTrainingRecordRepository(client),
    });

    if (!storageConfiguration) {
      return {
        metrics: result.metrics,
        modelName: 'movie-recommender-baseline',
        modelPath: result.modelPath,
        status: 'trained',
        trainingRecordCount: result.recordsCount,
      };
    }

    if (!artifactVersion) {
      throw new Error('MODEL_VERSION ou SOURCE_COMMIT_SHA/WORKFLOW_RUN_ID precisam ser definidos para publicar o modelo.');
    }

    const published = await publishAndActivateModel({
      artifactDirectory: modelDirectory,
      artifactVersion,
      modelScoreProviderFactory: { create: createTensorflowModelScoreProvider },
      now,
      sourceCommitSha: process.env.SOURCE_COMMIT_SHA ?? process.env.GITHUB_SHA,
      storage: createS3ModelArtifactStorage(storageConfiguration),
      storagePrefix: storageConfiguration.prefix,
      versions: createLibsqlModelVersionRepository(client),
      workflowRunId: process.env.WORKFLOW_RUN_ID ?? process.env.GITHUB_RUN_ID,
    });

    return {
      artifactVersion: published.artifactVersion,
      metrics: result.metrics,
      modelName: 'movie-recommender-baseline',
      modelPath: result.modelPath,
      status: published.status,
      trainingRecordCount: result.recordsCount,
    };
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const startedAt = Date.now();

  void startObservability({ serviceName: 'train' })
    .then(() => runTrainingJob())
    .then(async (result) => {
      recordTrainingJob({ durationSeconds: (Date.now() - startedAt) / 1000, result: 'trained' });
      console.log(JSON.stringify(result, null, 2));
      await stopObservability();
    })
    .catch(async (error: unknown) => {
      recordTrainingJob({ durationSeconds: (Date.now() - startedAt) / 1000, result: 'failed' });
      recordFailedOperation('training.job', error);
      console.error(error);
      await stopObservability();
      process.exitCode = 1;
    });
}
