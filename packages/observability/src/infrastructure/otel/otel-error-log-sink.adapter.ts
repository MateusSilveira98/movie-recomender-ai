import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { LogEntry, LogValue } from '@pkg/logger';

export function emitErrorLogEntry(entry: LogEntry): void {
  logs.getLogger('movie-recommender').emit({
    attributes: toOtelLogAttributes(entry),
    body: entry.event,
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
  });
}

function toOtelLogAttributes(entry: LogEntry): Record<string, boolean | number | string> {
  const attributes: Record<string, boolean | number | string> = {};

  for (const [key, value] of Object.entries(entry)) {
    assignNonNullAttribute(attributes, key, value);
  }

  return attributes;
}

function assignNonNullAttribute(
  attributes: Record<string, boolean | number | string>,
  key: string,
  value: LogValue,
): void {
  if (value === null) {
    return;
  }

  attributes[key] = value;
}
