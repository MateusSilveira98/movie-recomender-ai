export interface ObservabilityConfiguration {
  appEnv: string;
  enabled: boolean;
  endpoint: string;
  eventsDataset: string;
  metricsDataset: string;
  serviceName: string;
  token: string;
}

export function readObservabilityConfiguration(
  environment: NodeJS.ProcessEnv,
  serviceName: string,
): ObservabilityConfiguration {
  const appEnv = environment.APP_ENV?.trim() || environment.NODE_ENV?.trim() || 'development';
  const endpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? '';
  const token = environment.AXIOM_TOKEN?.trim() ?? '';
  const forced = environment.OTEL_ENABLED === 'true';
  const productionLike = appEnv === 'production' || appEnv === 'prod';

  return {
    appEnv,
    enabled: token !== '' && endpoint !== '' && (forced || productionLike),
    endpoint,
    eventsDataset: environment.AXIOM_EVENTS_DATASET?.trim() || 'movie-recommender-events',
    metricsDataset: environment.AXIOM_METRICS_DATASET?.trim() || 'movie-recommender-metrics',
    serviceName: environment.OTEL_SERVICE_NAME?.trim() || serviceName,
    token,
  };
}
