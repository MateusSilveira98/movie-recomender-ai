import { readFileSync } from 'node:fs';

export function resolveSecretEnvironmentValue(
  environment: object,
  name: string,
): string | undefined {
  const values = environment as Readonly<Record<string, string | undefined>>;
  const environmentValue = optionalValue(values[name]);
  if (environmentValue) return environmentValue;

  const secretFile = values[`${name}_FILE`] ?? `/etc/secrets/${name}`;
  try {
    return optionalValue(readFileSync(secretFile, 'utf8'));
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new Error(`${name} não pôde ser lido do arquivo secreto.`);
  }
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
