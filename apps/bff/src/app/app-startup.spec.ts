import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import type { Client } from '@libsql/client';
import { createApp } from './app.js';

describe('BFF startup healthcheck', () => {
  it('keeps health available when initial cleanup fails', async () => {
    const app = createApp({ databaseClient: { batch: async () => { throw new Error('Database unavailable'); } } as unknown as Client, processDatasetQueue: false });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    try {
      assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`)).status, 200);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))); }
  });
});
