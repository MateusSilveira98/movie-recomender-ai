import { logger, resolveErrorName, setErrorLogSink } from '@pkg/logger';
import { emitErrorLogEntry } from '../../infrastructure/otel/otel-error-log-sink.adapter.js';
import { startOtelSdk, type StartedSdk } from '../../infrastructure/otel/otel-sdk.adapter.js';
import { readObservabilityConfiguration } from './read-observability-configuration.service.js';

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
    startedSdk = await startOtelSdk(configuration);
    registerShutdownHooks();
    return true;
  } catch (error) {
    logger.error({
      component: 'observability',
      error: resolveErrorName(error),
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
      error: resolveErrorName(error),
      event: 'shutdown_failed',
    });
  }
}

function registerErrorLogSink(): void {
  setErrorLogSink(emitErrorLogEntry);
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
