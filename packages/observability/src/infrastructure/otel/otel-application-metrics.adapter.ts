import { metrics } from '@opentelemetry/api';
import type {
  ActiveModelMetric,
  HttpRequestMetric,
  ImportChunkMetric,
  QueueConsumeMetric,
  QueuePublishMetric,
  TrainingJobMetric,
} from '../../domain/models/application-telemetry.model.js';

const meter = metrics.getMeter('movie-recommender');

const httpDuration = meter.createHistogram('http.server.request.duration', {
  unit: 'ms',
});
const httpRequests = meter.createCounter('http.server.requests');
const queuePublish = meter.createCounter('queue.publish');
const queueConsume = meter.createCounter('queue.consume');
const importChunks = meter.createCounter('import.chunks');
const importJobs = meter.createCounter('import.jobs');
const trainingDuration = meter.createHistogram('training.duration', { unit: 's' });
const trainingJobs = meter.createCounter('training.jobs');
const activeModel = meter.createGauge('model.active.info');

export function recordHttpRequest(input: HttpRequestMetric): void {
  const attributes = {
    http_method: input.method,
    http_route: input.route,
    http_status: input.status,
  };

  httpDuration.record(input.durationMs, attributes);
  httpRequests.add(1, attributes);
}

export function recordQueuePublish(input: QueuePublishMetric): void {
  queuePublish.add(input.count, { dataset_type: input.datasetType });
}

export function recordQueueConsume(input: QueueConsumeMetric): void {
  queueConsume.add(1, { dataset_type: input.datasetType, result: input.result });
}

export function recordImportChunk(input: ImportChunkMetric): void {
  importChunks.add(1, { dataset_type: input.datasetType, result: input.result });
}

export function recordImportJob(result: string): void {
  importJobs.add(1, { result });
}

export function recordTrainingJob(input: TrainingJobMetric): void {
  trainingDuration.record(input.durationSeconds, { result: input.result });
  trainingJobs.add(1, { result: input.result });
}

export function recordActiveModel(input: ActiveModelMetric): void {
  activeModel.record(input.mode === 'inference' ? 1 : 0, {
    mode: input.mode,
    model_version: input.modelVersion ?? 'none',
  });
}
