import type { LogEntry } from '../models/log-entry.model.js';

export interface Logger {
  error(entry: LogEntry): void;
  info(entry: LogEntry): void;
}

export type LogWriter = (message: string) => void;
export type ErrorLogSink = (entry: LogEntry) => void;
