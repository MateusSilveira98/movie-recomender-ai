import { metrics } from '@opentelemetry/api';

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

export function recordHttpRequest(input: {
  durationMs: number;
  method: string;
  route: string;
  status: number;
}): void {
  const attributes = { http_method: input.method, http_route: input.route, http_status: input.status };
  httpDuration.record(input.durationMs, attributes);
  httpRequests.add(1, attributes);
}

export function recordQueuePublish(count: number, type: string): void {
  queuePublish.add(count, { dataset_type: type });
}

export function recordQueueConsume(result: 'ack' | 'nack' | 'retry', type: string): void {
  queueConsume.add(1, { dataset_type: type, result });
}

export function recordImportChunk(result: 'processed' | 'failed', type: string): void {
  importChunks.add(1, { dataset_type: type, result });
}

export function recordImportJob(result: string): void {
  importJobs.add(1, { result });
}

export function recordTrainingJob(input: { durationSeconds: number; result: 'trained' | 'failed' }): void {
  trainingDuration.record(input.durationSeconds, { result: input.result });
  trainingJobs.add(1, { result: input.result });
}

export function recordActiveModel(input: { mode: string; modelVersion?: string | null }): void {
  activeModel.record(input.mode === 'inference' ? 1 : 0, {
    mode: input.mode,
    model_version: input.modelVersion ?? 'none',
  });
}
