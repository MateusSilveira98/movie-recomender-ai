import { createBaseLogEntry, type LogEntry, type LogValue } from '../models/log-entry.model.js';

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|set-cookie/i;
const BEARER_VALUE = /bearer\s+\S+/i;
const AXIOM_TOKEN_VALUE = /\bxaat-[0-9a-f-]+\b/i;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const MAX_LOG_TEXT_LENGTH = 200;

export function redactLogEntry(entry: LogEntry): LogEntry {
  const redacted = createBaseLogEntry(entry);

  for (const [key, value] of Object.entries(entry)) {
    assignRedactedField(redacted, key, value);
  }

  return redacted;
}

function assignRedactedField(target: LogEntry, key: string, value: LogValue): void {
  if (isReservedOrSensitiveKey(key)) {
    return;
  }

  target[key] = redactLogValue(value);
}

function isReservedOrSensitiveKey(key: string): boolean {
  return isReservedLogKey(key) || SENSITIVE_KEY.test(key);
}

function isReservedLogKey(key: string): boolean {
  return key === 'component' || key === 'event';
}

function redactLogValue(value: LogValue): LogValue {
  if (typeof value !== 'string') {
    return value;
  }

  if (containsSecretPattern(value)) {
    return '[redacted]';
  }

  return truncateLogText(value);
}

function containsSecretPattern(value: string): boolean {
  return BEARER_VALUE.test(value) || AXIOM_TOKEN_VALUE.test(value) || JWT_VALUE.test(value);
}

function truncateLogText(value: string): string {
  return value.length > MAX_LOG_TEXT_LENGTH ? value.slice(0, MAX_LOG_TEXT_LENGTH) : value;
}
