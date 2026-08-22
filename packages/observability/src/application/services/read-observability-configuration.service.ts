import {
  isObservabilityForced,
  shouldEnableObservabilityExport,
  type ObservabilityConfiguration,
  type ObservabilityEnvironment,
} from '../../domain/models/observability-configuration.model.js';

export function readObservabilityConfiguration(
  environment: ObservabilityEnvironment,
  serviceName: string,
): ObservabilityConfiguration {
  const appEnv = firstPresentText(environment.APP_ENV, environment.NODE_ENV) || 'development';
  const credentials = {
    endpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? '',
    token: environment.AXIOM_TOKEN?.trim() ?? '',
  };

  return {
    appEnv,
    enabled: shouldEnableObservabilityExport({
      appEnv,
      credentials,
      forced: isObservabilityForced(environment),
    }),
    endpoint: credentials.endpoint,
    eventsDataset: firstPresentText(environment.AXIOM_EVENTS_DATASET) || 'movie-recommender-events',
    metricsDataset: firstPresentText(environment.AXIOM_METRICS_DATASET) || 'movie-recommender-metrics',
    serviceName: firstPresentText(environment.OTEL_SERVICE_NAME) || serviceName,
    token: credentials.token,
  };
}

function firstPresentText(...values: Array<string | undefined>): string {
  return values.map((value) => value?.trim() ?? '').find((value) => value !== '') ?? '';
}
