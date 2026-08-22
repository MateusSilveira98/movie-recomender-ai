import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readObservabilityConfiguration } from './observability-configuration.service.js';

describe('readObservabilityConfiguration', () => {
  it('deve ficar desligada no Compose local mesmo com token', () => {
    const configuration = readObservabilityConfiguration({
      APP_ENV: 'docker-local',
      AXIOM_TOKEN: 'xaat-test',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://api.axiom.co',
    }, 'bff');

    assert.equal(configuration.enabled, false);
    assert.equal(configuration.serviceName, 'bff');
  });

  it('deve ligar em produção quando token e endpoint existem', () => {
    const configuration = readObservabilityConfiguration({
      APP_ENV: 'production',
      AXIOM_EVENTS_DATASET: 'movie-recommender-events',
      AXIOM_METRICS_DATASET: 'movie-recommender-metrics',
      AXIOM_TOKEN: 'xaat-test',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://api.axiom.co',
    }, 'bff');

    assert.equal(configuration.enabled, true);
  });

  it('deve permitir smoke local só com OTEL_ENABLED=true', () => {
    const configuration = readObservabilityConfiguration({
      APP_ENV: 'docker-local',
      AXIOM_TOKEN: 'xaat-test',
      OTEL_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://api.axiom.co',
    }, 'train');

    assert.equal(configuration.enabled, true);
    assert.equal(configuration.serviceName, 'train');
  });
});
