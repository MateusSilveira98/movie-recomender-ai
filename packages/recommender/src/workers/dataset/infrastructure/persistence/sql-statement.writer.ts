import type { Client } from '@libsql/client';
import type { SqlStatement } from '../../domain/dataset.types.js';

export async function flushStatements(client: Client, statements: SqlStatement[], chunkSize = 200): Promise<void> {
  while (statements.length > 0) {
    await client.batch(statements.splice(0, chunkSize), 'write');
  }
}
