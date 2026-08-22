export type LogValue = boolean | number | string | null;

export interface LogEntry {
  component: string;
  event: string;
  [key: string]: LogValue;
}
