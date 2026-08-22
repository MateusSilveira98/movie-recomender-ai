import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { resolveErrorName } from '@pkg/logger';
import {
  isFailedImportResult,
  isServerErrorStatus,
  type ImportJobSummary,
} from '../../domain/models/application-telemetry.model.js';
import { IMPORT_SUMMARY_ATTRIBUTE, IMPORT_SUMMARY_VALUE } from '../../domain/services/exportable-span.policy.js';
import { recordImportJob } from './otel-application-metrics.adapter.js';

const tracer = trace.getTracer('movie-recommender');

export function startServerSpan(method: string, route: string): Span {
  return tracer.startSpan(`HTTP ${method} ${route}`, {
    attributes: {
      'http.method': method,
      'http.route': route,
    },
  });
}

export function finishServerSpan(span: Span, status: number): void {
  span.setAttribute('http.status_code', status);

  if (isServerErrorStatus(status)) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end();
}

export function recordImportJobSummary(input: ImportJobSummary): void {
  recordImportJob(input.result);
  const span = tracer.startSpan('import.job.summary', {
    attributes: {
      [IMPORT_SUMMARY_ATTRIBUTE]: IMPORT_SUMMARY_VALUE,
      'import.imported': input.imported,
      'import.job_id': input.jobId,
      'import.processed': input.processed,
      'import.rejected': input.rejected,
      'import.result': input.result,
      'import.waiting_dependencies': input.waitingDependencies,
    },
  });

  if (isFailedImportResult(input.result)) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end();
}

export function recordFailedOperation(name: string, error: unknown): void {
  const errorName = resolveErrorName(error);
  const span = tracer.startSpan(name);
  span.setStatus({ code: SpanStatusCode.ERROR, message: errorName });
  span.setAttribute('error.type', errorName);
  span.end();
}
