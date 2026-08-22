import { createErrorFingerprint } from './error-fingerprint.service.js';
import { redactLogEntry, selectExportableLogFields } from './log-entry-redaction.service.js';
import type { LogEntry } from './log-entry.model.js';

export type { LogEntry, LogValue } from './log-entry.model.js';
export { createErrorFingerprint } from './error-fingerprint.service.js';
export { redactLogEntry, selectExportableLogFields, LOG_EXPORT_FIELDS } from './log-entry-redaction.service.js';

export interface Logger {
  error(entry: LogEntry): void;
  info(entry: LogEntry): void;
}

type LogWriter = (message: string) => void;
type ErrorLogSink = (entry: LogEntry) => void;

let errorLogSink: ErrorLogSink | null = null;

export function setErrorLogSink(sink: ErrorLogSink | null): void {
  errorLogSink = sink;
}

export function createLogger(infoWriter: LogWriter = console.log, errorWriter: LogWriter = console.error): Logger {
  return {
    error(entry) {
      const sanitized = redactLogEntry({
        ...entry,
        fingerprint: createErrorFingerprint(entry),
      });
      errorWriter(JSON.stringify(sanitized));
      errorLogSink?.(selectExportableLogFields(sanitized));
    },
    info(entry) {
      infoWriter(JSON.stringify(redactLogEntry(entry)));
    },
  };
}

export const logger = createLogger();
