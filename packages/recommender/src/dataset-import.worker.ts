import { logger } from '@pkg/logger';
import { runDatasetImport } from './workers/dataset/application/dataset-import.service.js';

runDatasetImport().catch((error: unknown) => {
  logger.error({ component: 'dataset-import', error: error instanceof Error ? error.name : 'UnknownError', event: 'process_failed' });
  process.exitCode = 1;
});
