const ARTIFACT_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ARTIFACT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function getModelArtifactKey(prefix: string, artifactVersion: string, fileName: string): string {
  return `${normalizeModelArtifactPrefix(prefix)}/${normalizeModelArtifactVersion(artifactVersion)}/${normalizeModelArtifactFileName(fileName)}`;
}

export function normalizeModelArtifactFileName(fileName: string): string {
  const normalized = fileName.trim();

  if (!ARTIFACT_FILE_NAME_PATTERN.test(normalized)) {
    throw new Error('O nome do arquivo do artefato é inválido.');
  }

  return normalized;
}

export function normalizeModelArtifactPrefix(prefix: string): string {
  const segments = prefix.trim().split('/');

  if (segments.length === 0 || segments.some((segment) => !ARTIFACT_FILE_NAME_PATTERN.test(segment))) {
    throw new Error('O prefixo do artefato é inválido.');
  }

  return segments.join('/');
}

export function normalizeModelArtifactVersion(artifactVersion: string): string {
  const normalized = artifactVersion.trim();

  if (!ARTIFACT_VERSION_PATTERN.test(normalized)) {
    throw new Error('A versão do artefato é inválida.');
  }

  return normalized;
}
