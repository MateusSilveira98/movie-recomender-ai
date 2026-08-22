import type { ObservabilityConfiguration } from '../../domain/models/observability-configuration.model.js';
import { createAxiomOtlpHeaders, trimOtlpEndpoint } from './otel-headers.factory.js';

export interface StartedSdk {
  shutdown(): Promise<void>;
}

export async function startOtelSdk(configuration: ObservabilityConfiguration): Promise<StartedSdk> {
  const modules = await loadOtelModules();
  const sdk = createNodeSdk(modules, configuration);
  sdk.start();
  return sdk;
}

async function loadOtelModules() {
  const [
    { NodeSDK },
    { resourceFromAttributes },
    { ATTR_SERVICE_NAME },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { OTLPLogExporter },
    { BatchSpanProcessor },
    { PeriodicExportingMetricReader },
    { BatchLogRecordProcessor },
    { ErrorOnlySpanProcessor },
  ] = await Promise.all([
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

  return {
    ATTR_SERVICE_NAME,
    BatchLogRecordProcessor,
    BatchSpanProcessor,
    ErrorOnlySpanProcessor,
    NodeSDK,
    OTLPLogExporter,
    OTLPMetricExporter,
    OTLPTraceExporter,
    PeriodicExportingMetricReader,
    resourceFromAttributes,
  };
}

function createNodeSdk(
  modules: Awaited<ReturnType<typeof loadOtelModules>>,
  configuration: ObservabilityConfiguration,
): StartedSdk & { start(): void } {
  const endpoint = trimOtlpEndpoint(configuration.endpoint);
  const eventHeaders = createAxiomOtlpHeaders(configuration.token, configuration.eventsDataset);
  const metricHeaders = createAxiomOtlpHeaders(configuration.token, configuration.metricsDataset);

  return new modules.NodeSDK({
    logRecordProcessors: [
      new modules.BatchLogRecordProcessor({
        exporter: new modules.OTLPLogExporter({
          headers: eventHeaders,
          url: `${endpoint}/v1/logs`,
        }),
      }),
    ],
    metricReaders: [
      new modules.PeriodicExportingMetricReader({
        exporter: new modules.OTLPMetricExporter({
          headers: metricHeaders,
          url: `${endpoint}/v1/metrics`,
        }),
        exportIntervalMillis: 60_000,
      }),
    ],
    resource: modules.resourceFromAttributes({
      [modules.ATTR_SERVICE_NAME]: configuration.serviceName,
      'deployment.environment': configuration.appEnv,
    }),
    spanProcessors: [
      new modules.ErrorOnlySpanProcessor(new modules.BatchSpanProcessor(new modules.OTLPTraceExporter({
        headers: eventHeaders,
        url: `${endpoint}/v1/traces`,
      }))),
    ],
  });
}
