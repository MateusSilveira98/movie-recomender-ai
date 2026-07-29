import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger } from './index.js';

describe('logger', () => {
  it('deve serializar eventos informativos estruturados', () => {
    const entries: string[] = [];
    const logger = createLogger((entry) => entries.push(entry));

    logger.info({ component: 'bff', event: 'started', port: 3333 });

    assert.deepEqual(JSON.parse(entries[0]), { component: 'bff', event: 'started', port: 3333 });
  });

  it('deve escrever eventos de erro em um canal separado', () => {
    const errors: string[] = [];
    const logger = createLogger(() => undefined, (entry) => errors.push(entry));

    logger.error({ component: 'dataset-import', event: 'failed', error: 'Error' });

    assert.deepEqual(JSON.parse(errors[0]), { component: 'dataset-import', event: 'failed', error: 'Error' });
  });
});
