import { build } from 'esbuild';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const exactAliases = new Map([
  ['@pkg/database', resolve(root, 'packages/database/src/index.ts')],
  ['@pkg/ml', resolve(root, 'packages/ml/src/index.ts')],
  ['@pkg/recommender', resolve(root, 'packages/recommender/src/index.ts')],
  ['@pkg/logger', resolve(root, 'packages/logger/src/index.ts')],
  ['@pkg/observability', resolve(root, 'packages/observability/src/index.ts')],
]);

const prefixAliases = [
  ['@pkg/shared/data-access/', resolve(root, 'packages/shared/src/data-access/')],
  ['@pkg/shared/entities/', resolve(root, 'packages/shared/src/entities/')],
  ['@pkg/shared/mocks/', resolve(root, 'packages/shared/src/mocks/')],
];

await build({
  absWorkingDir: root,
  alias: Object.fromEntries(exactAliases),
  bundle: true,
  entryPoints: ['apps/bff/src/main.ts'],
  format: 'esm',
  logLevel: 'info',
  outfile: 'dist/apps/bff/main.js',
  packages: 'external',
  platform: 'node',
  plugins: [{
    name: 'pkg-shared-alias',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@pkg\/shared\// }, (args) => {
        for (const [prefix, directory] of prefixAliases) {
          if (!args.path.startsWith(prefix)) continue;
          return { path: resolveTypeScriptPath(resolve(directory, args.path.slice(prefix.length))) };
        }

        return undefined;
      });
    },
  }],
  target: 'node22',
});

function resolveTypeScriptPath(basePath) {
  const candidates = [
    `${basePath}.ts`,
    resolve(basePath, 'index.ts'),
    basePath,
  ];

  const match = candidates.find((candidate) => isFile(candidate));
  if (!match) {
    throw new Error(`Não foi possível resolver ${basePath}.`);
  }

  return match;
}

function isFile(candidate) {
  return existsSync(candidate) && statSync(candidate).isFile();
}
