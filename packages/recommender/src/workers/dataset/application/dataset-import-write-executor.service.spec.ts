import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDatasetImportWriteExecutor } from './dataset-import-write-executor.service.js';

describe('executor de escrita da importação do dataset', () => {
  it('deve executar escritas concorrentes na ordem de entrada', async () => {
    const executor = createDatasetImportWriteExecutor();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = executor.execute(async () => {
      events.push('primeira-inicio');
      await firstRelease;
      events.push('primeira-fim');
    });
    const second = executor.execute(async () => { events.push('segunda'); });

    await Promise.resolve();
    assert.deepEqual(events, ['primeira-inicio']);
    releaseFirst?.();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['primeira-inicio', 'primeira-fim', 'segunda']);
  });

  it('deve repetir SQLITE_BUSY sem alterar a posição na fila', async () => {
    const delays: number[] = [];
    const executor = createDatasetImportWriteExecutor({ delay: async (milliseconds) => { delays.push(milliseconds); } });
    let attempts = 0;

    await executor.execute(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('SQLITE_BUSY: SQLite error: database is locked');
    });

    assert.equal(attempts, 3);
    assert.deepEqual(delays, [50, 100]);
  });
});
