import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { logger, setErrorLogSink, type LogEntry } from '@pkg/logger';
import { readObservabilityConfiguration } from './observability-configuration.service.js';

interface StartedSdk {
  shutdown(): Promise<void>;
}

let startedSdk: StartedSdk | null = null;
let hooksRegistered = false;

export async function startObservability(input: { serviceName: string }): Promise<boolean> {
  registerErrorLogSink();

  if (startedSdk) {
    return true;
  }

  const configuration = readObservabilityConfiguration(process.env, input.serviceName);
  if (!configuration.enabled) {
    return false;
  }

  try {
    const [{ NodeSDK }, { resourceFromAttributes }, { ATTR_SERVICE_NAME }, { OTLPTraceExporter }, { OTLPMetricExporter }, { OTLPLogExporter }, { BatchSpanProcessor }, { PeriodicExportingMetricReader }, { BatchLogRecordProcessor }, { ErrorOnlySpanProcessor }] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/exporter-metrics-otlp-http'),
      import('@opentelemetry/exporter-logs-otlp-http'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/sdk-metrics'),
      import('@opentelemetry/sdk-logs'),
      import('./error-only-span.processor.js'),
    ]);

    const endpoint = configuration.endpoint.replace(/\/$/, '');
    const eventHeaders = {
      Authorization: `Bearer ${configuration.token}`,
      'X-Axiom-Dataset': configuration.eventsDataset,
    };
    const metricHeaders = {
      Authorization: `Bearer ${configuration.token}`,
      'X-Axiom-Dataset': configuration.metricsDataset,
    };

    const sdk = new NodeSDK({
      logRecordProcessors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            headers: eventHeaders,
            url: `${endpoint}/v1/logs`,
          }),
        }),
      ],
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            headers: metricHeaders,
            url: `${endpoint}/v1/metrics`,
          }),
          exportIntervalMillis: 60_000,
        }),
      ],
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: configuration.serviceName,
        'deployment.environment': configuration.appEnv,
      }),
      spanProcessors: [
        new ErrorOnlySpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({
          headers: eventHeaders,
          url: `${endpoint}/v1/traces`,
        }))),
      ],
    });

    sdk.start();
    startedSdk = sdk;
    registerShutdownHooks();
    return true;
  } catch (error) {
    logger.error({
      component: 'observability',
      error: error instanceof Error ? error.name : 'UnknownError',
      event: 'start_failed',
    });
    return false;
  }
}

export async function stopObservability(): Promise<void> {
  const sdk = startedSdk;
  startedSdk = null;
  setErrorLogSink(null);

  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } catch (error) {
    logger.error({
      component: 'observability',
      error: error instanceof Error ? error.name : 'UnknownError',
      event: 'shutdown_failed',
    });
  }
}

function registerErrorLogSink(): void {
  setErrorLogSink((entry: LogEntry) => {
    const attributes: Record<string, string | number | boolean> = {};

    for (const [key, value] of Object.entries(entry)) {
      if (value !== null) {
        attributes[key] = value;
      }
    }

    logs.getLogger('movie-recommender').emit({
      attributes,
      body: entry.event,
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
    });
  });
}

function registerShutdownHooks(): void {
  if (hooksRegistered) {
    return;
  }

  hooksRegistered = true;
  process.once('SIGTERM', () => {
    void stopObservability();
  });
  process.once('SIGINT', () => {
    void stopObservability();
  });
}
