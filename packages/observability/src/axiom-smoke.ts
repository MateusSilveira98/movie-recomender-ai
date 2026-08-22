import { SpanStatusCode, metrics, trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { startObservability, stopObservability } from './application/services/start-observability.service.js';

async function run(): Promise<void> {
  process.env.OTEL_ENABLED = process.env.OTEL_ENABLED || 'true';
  const enabled = await startObservability({ serviceName: 'axiom-smoke' });

  if (!enabled) {
    throw new Error('Observabilidade desligada. Defina AXIOM_TOKEN, OTEL_EXPORTER_OTLP_ENDPOINT e OTEL_ENABLED=true.');
  }

  metrics.getMeter('movie-recommender').createCounter('smoke.requests').add(1, { result: 'ok' });
  logs.getLogger('movie-recommender').emit({
    attributes: { component: 'observability', event: 'smoke_error', fingerprint: 'observability/smoke_error/Error' },
    body: 'smoke_error',
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
  });

  const span = trace.getTracer('movie-recommender').startSpan('smoke.failure');
  span.setStatus({ code: SpanStatusCode.ERROR, message: 'smoke' });
  span.end();

  await stopObservability();
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Smoke do Axiom falhou.');
  process.exitCode = 1;
});
