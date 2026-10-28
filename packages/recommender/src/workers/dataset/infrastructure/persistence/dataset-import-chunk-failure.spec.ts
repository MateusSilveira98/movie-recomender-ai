import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient } from '@libsql/client';
import { setErrorLogSink, type LogEntry } from '@pkg/logger';
import { createSqlDatasetImportCreditChunkHandler, createSqlDatasetImportGateway } from '../dataset-import-queue.adapter.js';
import { createDatasetUploadWithJob } from './dataset-import-queue.repository.js';
import type { DatasetImportChunkPayloadReader } from '../storage/dataset-import-chunk-payload-reader.js';
import { createDatasetImportQueue } from '../../application/dataset-import-queue.service.js';
import type { DatasetImportChunkMessage } from '../../application/ports/dataset-import-chunk-dispatcher.port.js';

describe('falha de chunk de creditos no processamento de imports', () => {
  it('registra o erro original de SQLITE_IOERR no sink mesmo quando requeue falha', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chunk-failure-'));
    const client = createClient({ url: `file:${join(directory, 'database.db')}` });
    const exported: LogEntry[] = [];
    setErrorLogSink((entry) => exported.push(entry));

    try {
      await client.executeMultiple(await readFile('packages/database/src/schema.sql', 'utf8'));
      const content = 'id,cast,crew\n10,[],[]\n';
      const filePath = join(directory, 'credits.csv');
      await writeFile(filePath, content);
      const upload = await createDatasetUploadWithJob(client, { fileName: 'credits.csv', sizeBytes: content.length, storagePath: filePath, type: 'credits' });
      const messages: DatasetImportChunkMessage[] = [];
      const queue = createDatasetImportQueue(createSqlDatasetImportGateway(client), {
        publish: async (message: DatasetImportChunkMessage) => { messages.push(message); },
      } as never, { autoProcess: false });
      await queue.processPending();
      const message = messages[0];
      assert.ok(message, 'o processamento precisa publicar o chunk de créditos');

      const failingReader: DatasetImportChunkPayloadReader = {
        readBatches: async function* () {
          throw Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR', rawCode: 1034 });
        },
        readRecords: async () => [],
      } as never;
      const handler = createSqlDatasetImportCreditChunkHandler(client, failingReader);

      const originalExecute = client.execute.bind(client);
      client.execute = (async (statement: unknown) => {
        const sql = typeof statement === 'string' ? statement : (statement as { sql: string }).sql;
        if (sql.includes('UPDATE dataset_import_chunks SET status = \'queued\'')) {
          throw new Error('SQLITE_IOERR: falha secundaria no requeue');
        }
        return originalExecute(statement as never);
      }) as typeof client.execute;

      try {
        await assert.rejects(() => handler.process(message), /SQLITE_IOERR: disk I\/O error/);
      } finally {
        client.execute = originalExecute;
      }

      const primary = exported.find((entry) => entry.event === 'chunk_processing_failed');
      const secondary = exported.find((entry) => entry.event === 'secondary_operation_failed');
      assert.ok(secondary, 'a falha do requeue precisa ser registrada separadamente');
      assert.equal(secondary.operation, 'requeue_chunk');
      assert.ok(primary, 'o erro original do chunk precisa aparecer no log');
      assert.equal(primary.errorCode, 'SQLITE_IOERR');
      assert.equal(primary.rawCode, 1034);
      assert.equal(primary.fileType, 'credits');
      assert.equal(primary.jobId, upload.jobId);
      assert.match(String(primary.errorMessage), /SQLITE_IOERR: disk I\/O error/);
      assert.ok(String(primary.timestamp).length > 0);
    } finally {
      setErrorLogSink(null);
      await client.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
