export type LogValue = boolean | number | string | null;

export interface LogEntry {
  component: string;
  event: string;
  [key: string]: LogValue;
}

export type ErrorFingerprintInput = Pick<LogEntry, 'component' | 'event'> & Partial<Pick<LogEntry, 'error'>>;

export function createBaseLogEntry(entry: Pick<LogEntry, 'component' | 'event'>): LogEntry {
  return {
    component: entry.component,
    event: entry.event,
  };
}

export function resolveErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
