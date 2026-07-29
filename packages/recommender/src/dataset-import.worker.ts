import { logger } from '@pkg/logger';
import { createDatabaseClient } from '@pkg/database';
import { createDatasetImportQueue } from './workers/dataset/application/dataset-import-queue.service.js';

const client = createDatabaseClient();
const queue = createDatasetImportQueue(client);

queue.processPending()
  .catch((error: unknown) => {
    logger.error({ component: 'dataset-import', error: error instanceof Error ? error.name : 'UnknownError', event: 'process_failed' });
    process.exitCode = 1;
  })
  .finally(async () => client.close());
