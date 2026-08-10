import { normalizeModelArtifactPrefix, normalizeModelArtifactVersion } from '../../domain/services/model-artifact-path.service.js';

export interface ModelStorageConfiguration {
  accessKey: string;
  artifactVersion: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  prefix: string;
  region: string;
  secretKey: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

const BUCKET_PATTERN = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const LOCAL_HTTP_HOSTS = new Set(['localhost', 'minio', '127.0.0.1']);

export function getModelStorageConfiguration(environment: Environment = process.env): ModelStorageConfiguration | null {
  const artifactVersion = optionalValue(environment.MODEL_VERSION);

  if (!artifactVersion) {
    return null;
  }

  const endpoint = normalizeEndpoint(requiredValue(environment.MODEL_STORAGE_ENDPOINT, 'MODEL_STORAGE_ENDPOINT'));
  const bucket = requiredValue(environment.MODEL_STORAGE_BUCKET, 'MODEL_STORAGE_BUCKET');
  const region = requiredValue(environment.MODEL_STORAGE_REGION ?? 'us-east-1', 'MODEL_STORAGE_REGION');

  if (!BUCKET_PATTERN.test(bucket)) {
    throw new Error('MODEL_STORAGE_BUCKET é inválido.');
  }

  if (!/^[a-z0-9-]{2,63}$/.test(region)) {
    throw new Error('MODEL_STORAGE_REGION é inválido.');
  }

  return {
    accessKey: requiredValue(environment.MODEL_STORAGE_ACCESS_KEY, 'MODEL_STORAGE_ACCESS_KEY'),
    artifactVersion: normalizeModelArtifactVersion(artifactVersion),
    bucket,
    endpoint,
    forcePathStyle: booleanValue(environment.MODEL_STORAGE_FORCE_PATH_STYLE, true),
    prefix: normalizeModelArtifactPrefix(optionalValue(environment.MODEL_STORAGE_PREFIX) ?? 'movie-recommender'),
    region,
    secretKey: requiredValue(environment.MODEL_STORAGE_SECRET_KEY, 'MODEL_STORAGE_SECRET_KEY'),
  };
}

function booleanValue(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = optionalValue(value);

  if (!normalized) {
    return defaultValue;
  }

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  throw new Error('MODEL_STORAGE_FORCE_PATH_STYLE deve ser true ou false.');
}

function normalizeEndpoint(value: string): string {
  let endpoint: URL;

  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('MODEL_STORAGE_ENDPOINT é inválido.');
  }

  if (
    (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    endpoint.pathname !== '/' ||
    endpoint.search.length > 0 ||
    endpoint.hash.length > 0
  ) {
    throw new Error('MODEL_STORAGE_ENDPOINT é inválido.');
  }

  if (endpoint.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(endpoint.hostname)) {
    throw new Error('MODEL_STORAGE_ENDPOINT deve usar HTTPS fora do ambiente local.');
  }

  return endpoint.toString().replace(/\/$/, '');
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function requiredValue(value: string | undefined, name: string): string {
  const normalized = optionalValue(value);

  if (!normalized) {
    throw new Error(`${name} precisa ser definido para carregar o modelo.`);
  }

  return normalized;
}
