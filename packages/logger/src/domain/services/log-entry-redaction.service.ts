import { createBaseLogEntry, type LogEntry, type LogValue } from '../models/log-entry.model.js';

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|set-cookie/i;
const BEARER_VALUE = /bearer\s+\S+/i;
const AXIOM_TOKEN_VALUE = /\bxaat-[0-9a-f-]+\b/i;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const CREDENTIAL_URL_VALUE = /(?:[?&](?:authToken|auth_token|token|apiKey|api_key|password|secret)=[^&\s"']+)|(?:[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@)/i;
const MAX_LOG_TEXT_LENGTH = 200;
const MAX_STACK_TEXT_LENGTH = 4000;

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

  target[key] = redactLogValue(key, value);
}

function isReservedOrSensitiveKey(key: string): boolean {
  return isReservedLogKey(key) || SENSITIVE_KEY.test(key);
}

function isReservedLogKey(key: string): boolean {
  return key === 'component' || key === 'event';
}

function redactLogValue(key: string, value: LogValue): LogValue {
  if (typeof value !== 'string') {
    return value;
  }

  if (containsSecretPattern(value)) {
    return '[redacted]';
  }

  return truncateLogText(key, value);
}

function containsSecretPattern(value: string): boolean {
  return BEARER_VALUE.test(value) || AXIOM_TOKEN_VALUE.test(value) || JWT_VALUE.test(value) || CREDENTIAL_URL_VALUE.test(value);
}

function truncateLogText(key: string, value: string): string {
  const limit = key === 'errorStack' ? MAX_STACK_TEXT_LENGTH : MAX_LOG_TEXT_LENGTH;
  return value.length > limit ? value.slice(0, limit) : value;
}
