import type { LogEntry } from './log-entry.model.js';

const NAMED_ERROR = /^[A-Za-z][A-Za-z0-9]*Error$|^Error$|^UnknownError$/;

export function createErrorFingerprint(entry: Pick<LogEntry, 'component' | 'event'> & Partial<Pick<LogEntry, 'error'>>): string {
  return `${entry.component}/${entry.event}/${normalizeErrorToken(entry.error)}`;
}

function normalizeErrorToken(error: LogEntry['error'] | undefined): string {
  if (typeof error !== 'string' || error.trim() === '') {
    return 'Error';
  }

  const token = error.trim();
  return NAMED_ERROR.test(token) ? token : 'Error';
}
