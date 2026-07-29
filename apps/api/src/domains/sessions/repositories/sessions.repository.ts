import type { Client } from '@libsql/client';
import type { Session } from '../../../../../../packages/shared/src/entities/models/session.model.js';

export interface SessionRepository {
  create(session: Session): Promise<void>;
  findById(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
}

export function createSqlSessionRepository(databaseClient: Client): SessionRepository {
  return {
    async create(session) {
      await persistSession(databaseClient, session);
    },
    async findById(sessionId) {
      const sessionRow = await databaseClient.execute({
        sql: 'SELECT id, created_at FROM sessions WHERE id = ?',
        args: [sessionId],
      });

      const sessionRecord = sessionRow.rows[0];

      if (!sessionRecord) {
        return null;
      }

      const preferencesRow = await databaseClient.execute({
        sql: 'SELECT genres_json, runtime_preference, free_text FROM session_preferences WHERE session_id = ?',
        args: [sessionId],
      });

      const feedbackRows = await databaseClient.execute({
        sql: 'SELECT movie_id, feedback FROM session_movie_feedback WHERE session_id = ?',
        args: [sessionId],
      });

      const preferences = preferencesRow.rows[0];

      if (!preferences) {
        return null;
      }

      const history = buildHistoryFromFeedbackRows(feedbackRows.rows);

      return {
        id: String(sessionRecord.id),
        createdAt: String(sessionRecord.created_at),
        preferences: {
          genres: parseJsonArray(preferences.genres_json),
          runtime: toRuntimePreference(preferences.runtime_preference),
          freeText: String(preferences.free_text),
        },
        history,
      };
    },
    async save(session) {
      await databaseClient.execute({
        sql: 'UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        args: [session.id],
      }).catch(async () => {
        await persistSession(databaseClient, session);
      });

      await databaseClient.execute({
        sql: 'UPDATE session_preferences SET genres_json = ?, runtime_preference = ?, free_text = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?',
        args: [JSON.stringify(session.preferences.genres), session.preferences.runtime, session.preferences.freeText, session.id],
      });

      await databaseClient.execute({
        sql: 'DELETE FROM session_movie_feedback WHERE session_id = ?',
        args: [session.id],
      });

      await persistFeedback(databaseClient, session);
    },
  };
}

async function persistSession(databaseClient: Client, session: Session): Promise<void> {
  await databaseClient.execute({
    sql: 'INSERT INTO sessions (id, created_at, updated_at, status) VALUES (?, ?, ?, ?)',
    args: [session.id, session.createdAt, session.createdAt, 'active'],
  });

  await databaseClient.execute({
    sql: 'INSERT INTO session_preferences (id, session_id, genres_json, runtime_preference, free_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [
      session.id,
      session.id,
      JSON.stringify(session.preferences.genres),
      session.preferences.runtime,
      session.preferences.freeText,
      session.createdAt,
      session.createdAt,
    ],
  });

  await persistFeedback(databaseClient, session);
}

async function persistFeedback(databaseClient: Client, session: Session): Promise<void> {
  const feedbackEntries = [
    ...session.history.watched.map((movieId) => ({ movieId, feedback: 'watched' as const })),
    ...session.history.liked.map((movieId) => ({ movieId, feedback: 'liked' as const })),
    ...session.history.disliked.map((movieId) => ({ movieId, feedback: 'disliked' as const })),
  ];

  for (const entry of feedbackEntries) {
    await databaseClient.execute({
      sql: 'INSERT OR IGNORE INTO session_movie_feedback (id, session_id, movie_id, feedback, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      args: [`${session.id}:${entry.movieId}:${entry.feedback}`, session.id, entry.movieId, entry.feedback],
    });
  }
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function toRuntimePreference(value: unknown): Session['preferences']['runtime'] {
  if (value === 'any' || value === 'short' || value === 'medium' || value === 'long') {
    return value;
  }

  return 'any';
}

function buildHistoryFromFeedbackRows(rows: Array<Record<string, unknown>>): Session['history'] {
  const watched = new Set<string>();
  const liked = new Set<string>();
  const disliked = new Set<string>();

  for (const row of rows) {
    const movieId = String(row.movie_id ?? '');
    const feedback = String(row.feedback ?? '');

    if (movieId.length === 0) {
      continue;
    }

    watched.add(movieId);

    if (feedback === 'liked') {
      liked.add(movieId);
      disliked.delete(movieId);
    }

    if (feedback === 'disliked') {
      disliked.add(movieId);
      liked.delete(movieId);
    }
  }

  return {
    watched: Array.from(watched),
    liked: Array.from(liked),
    disliked: Array.from(disliked),
  };
}
