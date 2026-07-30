import { calculateRegressionMetrics } from '../../domain/services/regression-metrics.service.js';
import { ensureMinimumTrainingRecords, prepareTrainingData } from '../../domain/services/training-data-preparation.service.js';
import { splitTrainingData } from '../../domain/services/training-data-split.service.js';
import type { TrainingModelPort } from '../ports/training-model.port.js';
import type { TrainingRecordRepository } from '../ports/training-record.repository.port.js';
import type { TrainedModelPublisher } from '../ports/trained-model.publisher.port.js';

export interface TrainingResult {
  metrics: { mae: number; mse: number };
  modelPath: string;
  recordsCount: number;
}

export async function trainModel(dependencies: TrainingDependencies): Promise<TrainingResult> {
  const records = await dependencies.records.list();
  ensureMinimumTrainingRecords(records);
  const split = splitTrainingData(records);
  const trainData = prepareTrainingData(split.train);
  const validationData = prepareTrainingData(split.validation, trainData.featureScales);
  const model = dependencies.model.create(trainData.featureNames.length);

  try {
    await dependencies.model.train(model, trainData, validationData);
    const predictions = dependencies.model.predict(model, validationData.features).map((value) => value * trainData.targetScale);
    const labels = validationData.labels.map((value) => value * trainData.targetScale);
    const metrics = calculateRegressionMetrics(predictions, labels);
    const modelPath = await dependencies.publisher.publish(model, {
      featureNames: trainData.featureNames,
      featureScales: trainData.featureScales,
      metrics,
      targetScale: trainData.targetScale,
      trainedAt: dependencies.clock().toISOString(),
    });

    return { metrics, modelPath, recordsCount: records.length };
  } finally {
    model.dispose();
  }
}

export interface TrainingDependencies {
  clock: () => Date;
  model: TrainingModelPort;
  publisher: TrainedModelPublisher;
  records: TrainingRecordRepository;
}
