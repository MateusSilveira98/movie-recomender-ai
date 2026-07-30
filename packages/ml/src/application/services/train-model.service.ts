import { calculateRegressionMetrics } from '../../domain/services/regression-metrics.service.js';
import { prepareTrainingData } from '../../domain/services/training-data-preparation.service.js';
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
  const data = prepareTrainingData(records);
  const split = splitTrainingData(data);
  const model = dependencies.model.create(data.featureNames.length);

  try {
    await dependencies.model.train(model, split.train, split.validation);
    const predictions = dependencies.model.predict(model, split.validation.features).map((value) => value * data.targetScale);
    const labels = split.validation.labels.map((value) => value * data.targetScale);
    const metrics = calculateRegressionMetrics(predictions, labels);
    const modelPath = await dependencies.publisher.publish(model, {
      featureNames: data.featureNames,
      featureScales: data.featureScales,
      metrics,
      targetScale: data.targetScale,
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
