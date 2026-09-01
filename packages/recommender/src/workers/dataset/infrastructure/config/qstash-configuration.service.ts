import { resolveSecretEnvironmentValue } from '@pkg/shared/data-access/services/config-services/secret-environment.service';

export interface QstashConfiguration {
  callbackBaseUrl: string;
  currentSigningKey: string;
  nextSigningKey: string;
  token: string;
  url: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1']);
const QSTASH_KEYS = [
  'QSTASH_URL',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'QSTASH_CALLBACK_BASE_URL',
] as const;
const QSTASH_SECRET_KEYS = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
] as const;

export function getQstashConfiguration(environment: Environment = process.env): QstashConfiguration | null {
  if (!isProductionEnvironment(environment)) {
    return null;
  }

  const values = Object.fromEntries(QSTASH_KEYS.map((name) => [name, resolveValue(environment, name)])) as Record<typeof QSTASH_KEYS[number], string | undefined>;
  const present = QSTASH_KEYS.filter((name) => values[name]);

  if (present.length === 0) {
    return null;
  }

  if (present.length !== QSTASH_KEYS.length) {
    const missing = QSTASH_KEYS.filter((name) => !values[name]);
    throw new Error(`QStash está incompleto. Defina ${missing.join(', ')}.`);
  }

  return {
    callbackBaseUrl: normalizeHttpsUrl(requiredValue(values.QSTASH_CALLBACK_BASE_URL, 'QSTASH_CALLBACK_BASE_URL'), 'QSTASH_CALLBACK_BASE_URL'),
    currentSigningKey: requiredValue(values.QSTASH_CURRENT_SIGNING_KEY, 'QSTASH_CURRENT_SIGNING_KEY'),
    nextSigningKey: requiredValue(values.QSTASH_NEXT_SIGNING_KEY, 'QSTASH_NEXT_SIGNING_KEY'),
    token: requiredValue(values.QSTASH_TOKEN, 'QSTASH_TOKEN'),
    url: normalizeHttpsUrl(requiredValue(values.QSTASH_URL, 'QSTASH_URL'), 'QSTASH_URL'),
  };
}

function isProductionEnvironment(environment: Environment): boolean {
  return environment.APP_ENV === 'production' || environment.NODE_ENV === 'production';
}

export function qstashDatasetImportCommandUrl(configuration: QstashConfiguration): string {
  return `${configuration.callbackBaseUrl}/internal/qstash/dataset-imports/commands`;
}

function normalizeHttpsUrl(value: string, name: string): string {
  let endpoint: URL;

  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`${name} é inválido.`);
  }

  if (
    (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:')
    || endpoint.username.length > 0
    || endpoint.password.length > 0
    || endpoint.search.length > 0
    || endpoint.hash.length > 0
  ) {
    throw new Error(`${name} é inválido.`);
  }

  if (endpoint.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(endpoint.hostname)) {
    throw new Error(`${name} deve usar HTTPS fora do ambiente local.`);
  }

  return `${endpoint.origin}${endpoint.pathname.replace(/\/$/, '')}`;
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveValue(environment: Environment, name: typeof QSTASH_KEYS[number]): string | undefined {
  const environmentValue = optionalValue(environment[name]);
  if (environmentValue) return environmentValue;
  if (!QSTASH_SECRET_KEYS.includes(name as typeof QSTASH_SECRET_KEYS[number])) return undefined;
  return resolveSecretEnvironmentValue(environment, name);
}

function requiredValue(value: string | undefined, name: string): string {
  const normalized = optionalValue(value);

  if (!normalized) {
    throw new Error(`${name} precisa ser definido para usar o QStash.`);
  }

  return normalized;
}
