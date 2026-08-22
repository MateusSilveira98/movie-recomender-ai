import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { recordImportJob } from './application-metrics.service.js';
import { IMPORT_SUMMARY_ATTRIBUTE, IMPORT_SUMMARY_VALUE } from './exportable-span.policy.js';

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

  if (status >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end();
}

export function recordImportJobSummary(input: {
  imported: number;
  jobId: string;
  processed: number;
  rejected: number;
  result: string;
  waitingDependencies: number;
}): void {
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

  if (input.result === 'error' || input.result === 'failed') {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end();
}

export function recordFailedOperation(name: string, errorName: string): void {
  const span = tracer.startSpan(name);
  span.setStatus({ code: SpanStatusCode.ERROR, message: errorName });
  span.setAttribute('error.type', errorName);
  span.end();
}
