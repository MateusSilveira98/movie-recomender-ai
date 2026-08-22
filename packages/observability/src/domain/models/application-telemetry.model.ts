export interface HttpRequestMetric {
  durationMs: number;
  method: string;
  route: string;
  status: number;
}

export interface HttpRequestTelemetry {
  complete(input: Pick<HttpRequestMetric, 'durationMs' | 'route' | 'status'>): void;
}

export interface QueuePublishMetric {
  count: number;
  datasetType: string;
}

export interface QueueConsumeMetric {
  datasetType: string;
  result: QueueConsumeResult;
}

export interface ImportChunkMetric {
  datasetType: string;
  result: ImportChunkResult;
}

export interface ActiveModelMetric {
  mode: string;
  modelVersion?: string | null;
}

export interface TrainingJobMetric {
  durationSeconds: number;
  result: 'failed' | 'trained';
}

export type QueueConsumeResult = 'ack' | 'nack' | 'retry';
export type ImportChunkResult = 'failed' | 'processed';

export interface ImportJobSummary {
  imported: number;
  jobId: string;
  processed: number;
  rejected: number;
  result: string;
  waitingDependencies: number;
}

export function isFailedImportResult(result: string): boolean {
  return result === 'error' || result === 'failed';
}

export function isServerErrorStatus(status: number): boolean {
  return status >= 500;
}
