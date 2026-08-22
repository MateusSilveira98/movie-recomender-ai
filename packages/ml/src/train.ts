import { resolve } from 'node:path';
import { createDatabaseClient } from '@pkg/database';
import { recordFailedOperation, recordTrainingJob, startObservability, stopObservability } from '@pkg/observability';
import { publishModelArtifact } from './application/services/model-artifact-publisher.service.js';
import { trainModel } from './application/services/train-model.service.js';
import { getModelStorageConfiguration } from './infrastructure/config/model-storage-configuration.service.js';
import { createFileSystemTrainedModelPublisher } from './infrastructure/publishing/file-system-trained-model.publisher.js';
import { createLibsqlTrainingRecordRepository } from './infrastructure/persistence/libsql-training-record.repository.js';
import { createS3ModelArtifactStorage } from './infrastructure/persistence/s3-model-artifact-storage.adapter.js';
import { createTensorflowTrainingModel } from './infrastructure/tensorflow/tensorflow-training-model.adapter.js';

export interface TrainingJobResult {
  artifactVersion?: string;
  status: 'trained';
  modelName: 'movie-recommender-baseline';
  metrics: { mae: number; mse: number };
  modelPath: string;
  trainingRecordCount: number;
}

export async function runTrainingJob(): Promise<TrainingJobResult> {
  const client = createDatabaseClient();
  const modelDirectory = resolve(process.env.TRAINING_MODEL_DIR ?? 'models/movie-recommender-baseline');
  const storageConfiguration = getModelStorageConfiguration(process.env);

  try {
    const now = new Date();
    const result = await trainModel({
      clock: () => now,
      model: createTensorflowTrainingModel(),
      publisher: createFileSystemTrainedModelPublisher(modelDirectory),
      records: createLibsqlTrainingRecordRepository(client),
    });
    const artifact = storageConfiguration
      ? await publishModelArtifact({
        artifactDirectory: modelDirectory,
        artifactVersion: storageConfiguration.artifactVersion,
        now,
        storage: createS3ModelArtifactStorage(storageConfiguration),
        storagePrefix: storageConfiguration.prefix,
      })
      : undefined;

    return {
      artifactVersion: artifact?.artifactVersion,
      metrics: result.metrics,
      modelName: 'movie-recommender-baseline',
      modelPath: result.modelPath,
      status: 'trained',
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
