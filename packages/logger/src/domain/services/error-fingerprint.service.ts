import type { ErrorFingerprintInput, LogEntry } from '../models/log-entry.model.js';

const NAMED_ERROR = /^[A-Za-z][A-Za-z0-9]*Error$|^Error$|^UnknownError$/;

export function createErrorFingerprint(entry: ErrorFingerprintInput): string {
  return `${entry.component}/${entry.event}/${normalizeErrorToken(entry.error)}`;
}

function normalizeErrorToken(error: LogEntry['error'] | undefined): string {
  if (!isNamedErrorToken(error)) {
    return 'Error';
  }

  return error.trim();
}

function isNamedErrorToken(error: LogEntry['error'] | undefined): error is string {
  return typeof error === 'string' && NAMED_ERROR.test(error.trim());
}
