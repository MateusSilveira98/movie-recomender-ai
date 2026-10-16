import { logger } from '@pkg/logger';
import { applyDatabaseSchema } from './apply-schema.js';
import { createDatabaseClient, resolveDatabaseUrl } from './index.js';

async function main(): Promise<void> {
  const client = createDatabaseClient(resolveDatabaseUrl());

  try {
    await applyDatabaseSchema(client);
    logger.info({ component: 'database', event: 'schema_applied' });
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  logger.error({ component: 'database', error: error instanceof Error ? error.name : 'UnknownError', event: 'schema_failed' });
  process.exitCode = 1;
});
