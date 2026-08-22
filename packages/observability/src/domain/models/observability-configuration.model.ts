export interface ObservabilityConfiguration {
  appEnv: string;
  enabled: boolean;
  endpoint: string;
  eventsDataset: string;
  metricsDataset: string;
  serviceName: string;
  token: string;
}

export interface ObservabilityEnvironment {
  APP_ENV?: string;
  AXIOM_EVENTS_DATASET?: string;
  AXIOM_METRICS_DATASET?: string;
  AXIOM_TOKEN?: string;
  NODE_ENV?: string;
  OTEL_ENABLED?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_SERVICE_NAME?: string;
}

export interface ObservabilityCredentials {
  endpoint: string;
  token: string;
}

export function hasObservabilityCredentials(credentials: ObservabilityCredentials): boolean {
  return credentials.endpoint !== '' && credentials.token !== '';
}

export function isProductionLikeEnvironment(appEnv: string): boolean {
  return appEnv === 'production' || appEnv === 'prod';
}

export function isObservabilityForced(environment: ObservabilityEnvironment): boolean {
  return environment.OTEL_ENABLED === 'true';
}

export function shouldEnableObservabilityExport(input: {
  appEnv: string;
  credentials: ObservabilityCredentials;
  forced: boolean;
}): boolean {
  return hasObservabilityCredentials(input.credentials) && (input.forced || isProductionLikeEnvironment(input.appEnv));
}
