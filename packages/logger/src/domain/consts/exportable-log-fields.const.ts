import { createBaseLogEntry, type LogEntry } from '../models/log-entry.model.js';

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

export type ExportableLogField = typeof LOG_EXPORT_FIELDS[number];

export function selectExportableLogFields(entry: LogEntry): LogEntry {
  const exported = createBaseLogEntry(entry);

  for (const field of LOG_EXPORT_FIELDS) {
    assignDefinedExportField(exported, entry, field);
  }

  return exported;
}

function assignDefinedExportField(target: LogEntry, source: LogEntry, field: ExportableLogField): void {
  if (field === 'component' || field === 'event') {
    return;
  }

  const value = source[field];
  if (value === undefined) {
    return;
  }

  target[field] = value;
}
