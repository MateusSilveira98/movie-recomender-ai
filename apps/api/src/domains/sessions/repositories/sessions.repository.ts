import type { Session } from '../../../../../../packages/shared/src/entities/models/session.model.js';

export interface SessionRepository {
  create(session: Session): void;
  findById(sessionId: string): Session | null;
  save(session: Session): void;
}

export function createInMemorySessionRepository(): SessionRepository {
  const sessions = new Map<string, Session>();

  return {
    create(session) {
      sessions.set(session.id, session);
    },
    findById(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
    save(session) {
      sessions.set(session.id, session);
    },
  };
}
