import { createErrorFingerprint } from '../../domain/services/error-fingerprint.service.js';
import { selectExportableLogFields } from '../../domain/consts/exportable-log-fields.const.js';
import { redactLogEntry } from '../../domain/services/log-entry-redaction.service.js';
import type { ErrorLogSink, Logger, LogWriter } from '../../domain/ports/logger.port.js';
import type { LogEntry } from '../../domain/models/log-entry.model.js';

let errorLogSink: ErrorLogSink | null = null;

export function setErrorLogSink(sink: ErrorLogSink | null): void {
  errorLogSink = sink;
}

export function createLogger(infoWriter: LogWriter = console.log, errorWriter: LogWriter = console.error): Logger {
  return {
    error(entry) {
      writeError(errorWriter, entry);
    },
    info(entry) {
      infoWriter(JSON.stringify(redactLogEntry(entry)));
    },
  };
}

export const logger = createLogger();

function writeError(errorWriter: LogWriter, entry: LogEntry): void {
  const sanitized = redactLogEntry({
    ...entry,
    fingerprint: createErrorFingerprint(entry),
  });

  errorWriter(JSON.stringify(sanitized));
  errorLogSink?.(selectExportableLogFields(sanitized));
}
