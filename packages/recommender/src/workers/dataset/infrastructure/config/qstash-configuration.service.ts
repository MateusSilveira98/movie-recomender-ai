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

export function getQstashConfiguration(environment: Environment = process.env): QstashConfiguration | null {
  const present = QSTASH_KEYS.filter((name) => optionalValue(environment[name]));

  if (present.length === 0) {
    return null;
  }

  if (present.length !== QSTASH_KEYS.length) {
    const missing = QSTASH_KEYS.filter((name) => !optionalValue(environment[name]));
    throw new Error(`QStash está incompleto. Defina ${missing.join(', ')}.`);
  }

  return {
    callbackBaseUrl: normalizeHttpsUrl(requiredValue(environment.QSTASH_CALLBACK_BASE_URL, 'QSTASH_CALLBACK_BASE_URL'), 'QSTASH_CALLBACK_BASE_URL'),
    currentSigningKey: requiredValue(environment.QSTASH_CURRENT_SIGNING_KEY, 'QSTASH_CURRENT_SIGNING_KEY'),
    nextSigningKey: requiredValue(environment.QSTASH_NEXT_SIGNING_KEY, 'QSTASH_NEXT_SIGNING_KEY'),
    token: requiredValue(environment.QSTASH_TOKEN, 'QSTASH_TOKEN'),
    url: normalizeHttpsUrl(requiredValue(environment.QSTASH_URL, 'QSTASH_URL'), 'QSTASH_URL'),
  };
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

function requiredValue(value: string | undefined, name: string): string {
  const normalized = optionalValue(value);

  if (!normalized) {
    throw new Error(`${name} precisa ser definido para usar o QStash.`);
  }

  return normalized;
}
