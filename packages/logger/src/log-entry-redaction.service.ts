import type { LogEntry, LogValue } from './log-entry.model.js';

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|set-cookie/i;
const BEARER_VALUE = /bearer\s+\S+/i;
const AXIOM_TOKEN_VALUE = /\bxaat-[0-9a-f-]+\b/i;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;

export const LOG_EXPORT_FIELDS = [
  'component',
  'event',
  'fingerprint',
  'jobId',
  'chunkId',
  'operation',
  'status',
  'durationMs',
  'error',
] as const;

export function redactLogEntry(entry: LogEntry): LogEntry {
  const redacted: LogEntry = { component: entry.component, event: entry.event };

  for (const [key, value] of Object.entries(entry)) {
    if (key === 'component' || key === 'event' || SENSITIVE_KEY.test(key)) {
      continue;
    }

    redacted[key] = redactLogValue(value);
  }

  return redacted;
}

export function selectExportableLogFields(entry: LogEntry): LogEntry {
  const exported: LogEntry = { component: entry.component, event: entry.event };

  for (const field of LOG_EXPORT_FIELDS) {
    if (field === 'component' || field === 'event') {
      continue;
    }

    const value = entry[field];
    if (value !== undefined) {
      exported[field] = value;
    }
  }

  return exported;
}

function redactLogValue(value: LogValue): LogValue {
  if (typeof value !== 'string') {
    return value;
  }

  if (BEARER_VALUE.test(value) || AXIOM_TOKEN_VALUE.test(value) || JWT_VALUE.test(value)) {
    return '[redacted]';
  }

  return value.length > 200 ? value.slice(0, 200) : value;
}
