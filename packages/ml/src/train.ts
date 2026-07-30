import { resolve } from 'node:path';
import { createDatabaseClient } from '@pkg/database';
import { trainModel } from './application/services/train-model.service.js';
import { createFileSystemTrainedModelPublisher } from './infrastructure/publishing/file-system-trained-model.publisher.js';
import { createLibsqlTrainingRecordRepository } from './infrastructure/persistence/libsql-training-record.repository.js';
import { createTensorflowTrainingModel } from './infrastructure/tensorflow/tensorflow-training-model.adapter.js';

export interface TrainingJobResult {
  status: 'trained';
  modelName: 'movie-recommender-baseline';
  metrics: { mae: number; mse: number };
  modelPath: string;
  trainingRecordCount: number;
}

export async function runTrainingJob(): Promise<TrainingJobResult> {
  const client = createDatabaseClient();

  try {
    const result = await trainModel({
      clock: () => new Date(),
      model: createTensorflowTrainingModel(),
      publisher: createFileSystemTrainedModelPublisher(resolve(process.env.TRAINING_MODEL_DIR ?? 'models/movie-recommender-baseline')),
      records: createLibsqlTrainingRecordRepository(client),
    });

    return {
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
  runTrainingJob()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
