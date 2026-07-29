export type LogValue = boolean | number | string | null;

export interface LogEntry {
  component: string;
  event: string;
  [key: string]: LogValue;
}

export interface Logger {
  error(entry: LogEntry): void;
  info(entry: LogEntry): void;
}

type LogWriter = (message: string) => void;

export function createLogger(infoWriter: LogWriter = console.log, errorWriter: LogWriter = console.error): Logger {
  return {
    error(entry) {
      errorWriter(JSON.stringify(entry));
    },
    info(entry) {
      infoWriter(JSON.stringify(entry));
    },
  };
}

export const logger = createLogger();
