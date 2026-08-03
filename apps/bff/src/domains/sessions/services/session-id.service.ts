import { randomUUID } from 'node:crypto';

export function generateSessionId(): string {
  return randomUUID();
}
