import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, resolveDatabaseUrl } from './index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(moduleDir, 'schema.sql');
const databaseUrl = resolveDatabaseUrl();

async function main() {
  const schema = await readFile(schemaPath, 'utf8');
  const client = createDatabaseClient(databaseUrl);

  try {
    await client.executeMultiple(schema);
    console.log(`Schema aplicado em ${databaseUrl}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
