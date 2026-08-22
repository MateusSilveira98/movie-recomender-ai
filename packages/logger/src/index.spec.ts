import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger, setErrorLogSink, type LogEntry } from './index.js';

describe('logger', () => {
  it('deve serializar eventos informativos estruturados', () => {
    const entries: string[] = [];
    const logger = createLogger((entry) => entries.push(entry));

    logger.info({ component: 'bff', event: 'started', port: 3333 });

    assert.deepEqual(JSON.parse(entries[0]), { component: 'bff', event: 'started', port: 3333 });
  });

  it('deve escrever eventos de erro com fingerprint em um canal separado', () => {
    const errors: string[] = [];
    const logger = createLogger(() => undefined, (entry) => errors.push(entry));

    logger.error({ component: 'dataset-import', event: 'failed', error: 'Error' });

    assert.deepEqual(JSON.parse(errors[0]), {
      component: 'dataset-import',
      error: 'Error',
      event: 'failed',
      fingerprint: 'dataset-import/failed/Error',
    });
  });

  it('deve enviar ao sink somente o allowlist do erro', () => {
    const exported: LogEntry[] = [];
    setErrorLogSink((entry) => exported.push(entry));

    try {
      const logger = createLogger(() => undefined, () => undefined);
      logger.error({
        component: 'bff',
        event: 'request_failed',
        error: 'TypeError',
        method: 'GET',
        path: '/sessions',
      });

      assert.deepEqual(exported, [{
        component: 'bff',
        error: 'TypeError',
        event: 'request_failed',
        fingerprint: 'bff/request_failed/TypeError',
      }]);
    } finally {
      setErrorLogSink(null);
    }
  });
});
