import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { AnonymousProfile } from '@pkg/shared/entities/models/anonymous-profile.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { SessionFeedback } from '@pkg/shared/entities/types/session-feedback.type';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';

export interface StoredAnonymousProfile {
  expiresAtMs: number;
  id: string;
}

export interface StoredSession {
  createdAt: string;
  expiresAtMs: number;
  history: ViewerHistory;
  id: string;
  preferences: Preferences;
  profileId: string;
  roundId: string;
}

export interface StoredRecommendationRound {
  createdAt: string;
  history: ViewerHistory;
  preferences: Preferences;
  recommendations: StoredRecommendationImpression[];
  id: string;
}

export interface StoredRecommendationImpression {
  movieId: string;
  score: number;
}

export interface NewSession {
  candidateCount: number;
  createdAt: string;
  expiresAtMs: number;
  history: ViewerHistory;
  id: string;
  modelVersion?: string;
  preferences: Preferences;
  profileId: string;
  rankingVersion: string;
  roundId: string;
}

export interface FeedbackTarget {
  movieId: string;
  roundId: string;
}

export interface SessionRepository {
  abandonActiveSessions(profileId: string, nowMs: number): Promise<void>;
  cleanupExpired(nowMs: number): Promise<void>;
  createAnonymousProfile(id: string, tokenHash: string, nowMs: number, expiresAtMs: number): Promise<StoredAnonymousProfile>;
  createSession(session: NewSession): Promise<StoredSession>;
  findActiveProfileByTokenHash(tokenHash: string, nowMs: number): Promise<StoredAnonymousProfile | null>;
  findActiveSession(profileId: string, nowMs: number): Promise<StoredSession | null>;
  findFeedbackTarget(profileId: string, sessionId: string, impressionId: string, nowMs: number): Promise<FeedbackTarget | null>;
  findProfileState(profileId: string): Promise<AnonymousProfile>;
  findRecentRounds(profileId: string, sinceMs: number): Promise<StoredRecommendationRound[]>;
  recordFeedback(impressionId: string, feedback: SessionFeedback, nowMs: number): Promise<void>;
  recordImpressions(roundId: string, recommendations: Recommendation[], nowMs: number): Promise<Recommendation[]>;
  saveProfileState(profileId: string, profile: AnonymousProfile, nowMs: number): Promise<void>;
  saveSessionState(session: StoredSession, expiresAtMs: number, nowMs: number): Promise<boolean>;
  touchSession(sessionId: string, profileId: string, nowMs: number, expiresAtMs: number): Promise<boolean>;
  touchProfile(profileId: string, nowMs: number, expiresAtMs: number): Promise<boolean>;
}

export function createSqlSessionRepository(databaseClient: Client): SessionRepository {
  return {
    async abandonActiveSessions(profileId, nowMs) {
      await databaseClient.execute({
        sql: `UPDATE sessions
          SET status = 'abandoned', completed_at = COALESCE(completed_at, ?), updated_at = ?
          WHERE profile_id = ? AND status = 'active'`,
        args: [new Date(nowMs).toISOString(), new Date(nowMs).toISOString(), profileId],
      });
    },
    async cleanupExpired(nowMs) {
      const eventRetentionCutoffMs = nowMs - 180 * 24 * 60 * 60 * 1000;

      await databaseClient.batch(
        [
          {
            sql: `UPDATE sessions
              SET status = 'abandoned', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
              WHERE status = 'active' AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?`,
            args: [nowMs],
          },
          {
            sql: `UPDATE anonymous_profiles
              SET token_hash = 'invalidated:' || id, invalidated_at_ms = ?
              WHERE invalidated_at_ms IS NULL AND expires_at_ms <= ?`,
            args: [nowMs, nowMs],
          },
          {
            sql: `DELETE FROM anonymous_profile_preferences
              WHERE profile_id IN (SELECT id FROM anonymous_profiles WHERE invalidated_at_ms IS NOT NULL)`,
            args: [],
          },
          {
            sql: `DELETE FROM anonymous_profile_movie_feedback
              WHERE profile_id IN (SELECT id FROM anonymous_profiles WHERE invalidated_at_ms IS NOT NULL)`,
            args: [],
          },
          {
            sql: `DELETE FROM session_preferences
              WHERE session_id IN (
                SELECT id FROM sessions
                WHERE profile_id IN (SELECT id FROM anonymous_profiles WHERE invalidated_at_ms IS NOT NULL)
              )`,
            args: [],
          },
          {
            sql: `DELETE FROM session_movie_feedback
              WHERE session_id IN (
                SELECT id FROM sessions
                WHERE profile_id IN (SELECT id FROM anonymous_profiles WHERE invalidated_at_ms IS NOT NULL)
              )`,
            args: [],
          },
          {
            sql: `DELETE FROM recommendation_impression_feedbacks
              WHERE impression_id IN (
                SELECT id FROM recommendation_impressions WHERE created_at_ms < ?
              )`,
            args: [eventRetentionCutoffMs],
          },
          {
            sql: 'DELETE FROM recommendation_impressions WHERE created_at_ms < ?',
            args: [eventRetentionCutoffMs],
          },
          {
            sql: 'DELETE FROM recommendation_rounds WHERE created_at_ms < ?',
            args: [eventRetentionCutoffMs],
          },
          {
            sql: 'DELETE FROM sessions WHERE expires_at_ms IS NOT NULL AND expires_at_ms < ?',
            args: [eventRetentionCutoffMs],
          },
          {
            sql: 'DELETE FROM anonymous_profiles WHERE expires_at_ms < ?',
            args: [eventRetentionCutoffMs],
          },
        ],
        'write',
      );
    },
    async createAnonymousProfile(id, tokenHash, nowMs, expiresAtMs) {
      await databaseClient.batch(
        [
          {
            sql: `INSERT INTO anonymous_profiles (id, token_hash, created_at_ms, last_seen_at_ms, expires_at_ms)
              VALUES (?, ?, ?, ?, ?)`,
            args: [id, tokenHash, nowMs, nowMs, expiresAtMs],
          },
          {
            sql: `INSERT INTO anonymous_profile_preferences (profile_id, genres_json, runtime_preference, updated_at_ms)
              VALUES (?, '[]', 'any', ?)`,
            args: [id, nowMs],
          },
        ],
        'write',
      );

      return { expiresAtMs, id };
    },
    async createSession(session) {
      const feedbackEntries = historyEntries(session.history);
      const statements = [
        {
          sql: `INSERT INTO sessions (id, profile_id, expires_at_ms, created_at, updated_at, status)
            VALUES (?, ?, ?, ?, ?, 'active')`,
          args: [session.id, session.profileId, session.expiresAtMs, session.createdAt, session.createdAt],
        },
        {
          sql: `INSERT INTO session_preferences (
              id, session_id, genres_json, runtime_preference, free_text, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            session.id,
            session.id,
            JSON.stringify(session.preferences.genres),
            session.preferences.runtime,
            session.preferences.freeText,
            session.createdAt,
            session.createdAt,
          ],
        },
        {
          sql: `INSERT INTO recommendation_rounds (
              id, profile_id, session_id, sequence, genres_json, runtime_preference, ranking_version, model_version, candidate_count, created_at_ms
            ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          args: [
            session.roundId,
            session.profileId,
            session.id,
            JSON.stringify(session.preferences.genres),
            session.preferences.runtime,
            session.rankingVersion,
            session.modelVersion ?? null,
            session.candidateCount,
            Date.parse(session.createdAt),
          ],
        },
        ...feedbackEntries.map((entry) => ({
          sql: `INSERT INTO session_movie_feedback (id, session_id, movie_id, feedback, created_at)
            VALUES (?, ?, ?, ?, ?)`,
          args: [randomUUID(), session.id, entry.movieId, entry.feedback, session.createdAt],
        })),
      ];

      await databaseClient.batch(statements, 'write');

      return toStoredSession(session, session.roundId);
    },
    async findActiveProfileByTokenHash(tokenHash, nowMs) {
      const result = await databaseClient.execute({
        sql: `SELECT id, expires_at_ms
          FROM anonymous_profiles
          WHERE token_hash = ? AND invalidated_at_ms IS NULL AND expires_at_ms > ?`,
        args: [tokenHash, nowMs],
      });
      const row = result.rows[0];

      return row ? { expiresAtMs: Number(row.expires_at_ms), id: String(row.id) } : null;
    },
    async findActiveSession(profileId, nowMs) {
      const sessionResult = await databaseClient.execute({
        sql: `SELECT id, profile_id, expires_at_ms, created_at
          FROM sessions
          WHERE profile_id = ? AND status = 'active' AND expires_at_ms > ?
          ORDER BY updated_at DESC
          LIMIT 1`,
        args: [profileId, nowMs],
      });
      const sessionRow = sessionResult.rows[0];

      if (!sessionRow) {
        return null;
      }

      const sessionId = String(sessionRow.id);
      const [preferencesResult, feedbackResult, roundResult] = await Promise.all([
        databaseClient.execute({
          sql: `SELECT genres_json, runtime_preference, free_text
            FROM session_preferences WHERE session_id = ?`,
          args: [sessionId],
        }),
        databaseClient.execute({
          sql: 'SELECT movie_id, feedback FROM session_movie_feedback WHERE session_id = ?',
          args: [sessionId],
        }),
        databaseClient.execute({
          sql: `SELECT id FROM recommendation_rounds
            WHERE session_id = ? ORDER BY sequence DESC LIMIT 1`,
          args: [sessionId],
        }),
      ]);
      const preferencesRow = preferencesResult.rows[0];
      const roundRow = roundResult.rows[0];

      if (!preferencesRow || !roundRow) {
        return null;
      }

      return {
        createdAt: String(sessionRow.created_at),
        expiresAtMs: Number(sessionRow.expires_at_ms),
        history: historyFromRows(feedbackResult.rows),
        id: sessionId,
        preferences: preferencesFromRow(preferencesRow),
        profileId: String(sessionRow.profile_id),
        roundId: String(roundRow.id),
      };
    },
    async findFeedbackTarget(profileId, sessionId, impressionId, nowMs) {
      const result = await databaseClient.execute({
        sql: `SELECT impressions.movie_id, impressions.round_id
          FROM recommendation_impressions impressions
          JOIN recommendation_rounds rounds ON rounds.id = impressions.round_id
          JOIN sessions ON sessions.id = rounds.session_id
          WHERE impressions.id = ?
            AND rounds.profile_id = ?
            AND rounds.session_id = ?
            AND sessions.status = 'active'
            AND sessions.expires_at_ms > ?`,
        args: [impressionId, profileId, sessionId, nowMs],
      });
      const row = result.rows[0];

      return row ? { movieId: String(row.movie_id), roundId: String(row.round_id) } : null;
    },
    async findProfileState(profileId) {
      const [preferencesResult, feedbackResult] = await Promise.all([
        databaseClient.execute({
          sql: `SELECT genres_json, runtime_preference
            FROM anonymous_profile_preferences WHERE profile_id = ?`,
          args: [profileId],
        }),
        databaseClient.execute({
          sql: `SELECT movie_id, feedback FROM anonymous_profile_movie_feedback
            WHERE profile_id = ?`,
          args: [profileId],
        }),
      ]);

      return {
        history: historyFromRows(feedbackResult.rows),
        preferences: preferencesFromRow(preferencesResult.rows[0]),
      };
    },
    async findRecentRounds(profileId, sinceMs) {
      const [roundsResult, feedbackResult, impressionsResult] = await Promise.all([
        databaseClient.execute({
          sql: `SELECT id AS round_id, session_id, genres_json, runtime_preference, created_at_ms
            FROM recommendation_rounds
            WHERE profile_id = ? AND created_at_ms >= ?
            ORDER BY created_at_ms DESC`,
          args: [profileId, sinceMs],
        }),
        databaseClient.execute({
          sql: `SELECT session_movie_feedback.session_id, session_movie_feedback.movie_id, session_movie_feedback.feedback
            FROM session_movie_feedback
            JOIN recommendation_rounds ON recommendation_rounds.session_id = session_movie_feedback.session_id
            WHERE recommendation_rounds.profile_id = ? AND recommendation_rounds.created_at_ms >= ?`,
          args: [profileId, sinceMs],
        }),
        databaseClient.execute({
          sql: `SELECT impressions.round_id, impressions.movie_id, impressions.score
            FROM recommendation_impressions impressions
            JOIN recommendation_rounds rounds ON rounds.id = impressions.round_id
            WHERE rounds.profile_id = ? AND rounds.created_at_ms >= ?
            ORDER BY rounds.created_at_ms DESC, impressions.position ASC, impressions.created_at_ms ASC, impressions.id ASC`,
          args: [profileId, sinceMs],
        }),
      ]);
      const feedbackBySessionId = groupFeedbackBySessionId(feedbackResult.rows);
      const recommendationsByRoundId = groupRecommendationsByRoundId(impressionsResult.rows);

      return roundsResult.rows.map((row) => {
        const roundId = String(row.round_id ?? '');
        const sessionId = String(row.session_id);

        return {
          createdAt: new Date(Number(row.created_at_ms)).toISOString(),
          history: historyFromRows(feedbackBySessionId.get(sessionId) ?? []),
          id: roundId,
          preferences: preferencesFromRow(row),
          recommendations: recommendationsByRoundId.get(roundId) ?? [],
        };
      });
    },
    async recordFeedback(impressionId, feedback, nowMs) {
      await databaseClient.execute({
        sql: `INSERT INTO recommendation_impression_feedbacks (
            id, impression_id, feedback, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(impression_id) DO UPDATE SET feedback = excluded.feedback, updated_at_ms = excluded.updated_at_ms`,
        args: [randomUUID(), impressionId, feedback, nowMs, nowMs],
      });
    },
    async recordImpressions(roundId, recommendations, nowMs) {
      if (recommendations.length === 0) {
        return [];
      }

      await databaseClient.batch(
        recommendations.map((recommendation, index) => ({
          sql: `INSERT OR IGNORE INTO recommendation_impressions (
              id, round_id, movie_id, position, score, created_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [randomUUID(), roundId, recommendation.id, index + 1, recommendation.score, nowMs],
        })),
        'write',
      );

      const placeholders = recommendations.map(() => '?').join(', ');
      const result = await databaseClient.execute({
        sql: `SELECT id, movie_id FROM recommendation_impressions
          WHERE round_id = ? AND movie_id IN (${placeholders})`,
        args: [roundId, ...recommendations.map((recommendation) => recommendation.id)],
      });
      const impressionsByMovieId = new Map(result.rows.map((row) => [String(row.movie_id), String(row.id)]));

      return recommendations.flatMap((recommendation) => {
        const impressionId = impressionsByMovieId.get(recommendation.id);

        return impressionId ? [{ ...recommendation, impressionId }] : [];
      });
    },
    async saveProfileState(profileId, profile, nowMs) {
      const history = normalizeHistory(profile.history);
      const feedbackEntries = historyEntries(history);

      await databaseClient.batch(
        [
          {
            sql: `INSERT INTO anonymous_profile_preferences (profile_id, genres_json, runtime_preference, updated_at_ms)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(profile_id) DO UPDATE SET
                genres_json = excluded.genres_json,
                runtime_preference = excluded.runtime_preference,
                updated_at_ms = excluded.updated_at_ms`,
            args: [profileId, JSON.stringify(profile.preferences.genres), profile.preferences.runtime, nowMs],
          },
          {
            sql: 'DELETE FROM anonymous_profile_movie_feedback WHERE profile_id = ?',
            args: [profileId],
          },
          ...feedbackEntries.map((entry) => ({
            sql: `INSERT INTO anonymous_profile_movie_feedback (profile_id, movie_id, feedback, updated_at_ms)
              VALUES (?, ?, ?, ?)`,
            args: [profileId, entry.movieId, entry.feedback, nowMs],
          })),
        ],
        'write',
      );
    },
    async saveSessionState(session, expiresAtMs, nowMs) {
      const history = normalizeHistory(session.history);
      const feedbackEntries = historyEntries(history);
      const refreshResult = await databaseClient.execute({
        sql: `UPDATE sessions
          SET updated_at = ?, expires_at_ms = ?
          WHERE id = ? AND profile_id = ? AND status = 'active' AND expires_at_ms > ?`,
        args: [new Date(nowMs).toISOString(), expiresAtMs, session.id, session.profileId, nowMs],
      });

      if (refreshResult.rowsAffected !== 1) {
        return false;
      }

      await databaseClient.batch(
        [
          {
            sql: `UPDATE session_preferences
              SET genres_json = ?, runtime_preference = ?, free_text = ?, updated_at = ?
              WHERE session_id = ?`,
            args: [
              JSON.stringify(session.preferences.genres),
              session.preferences.runtime,
              session.preferences.freeText,
              new Date(nowMs).toISOString(),
              session.id,
            ],
          },
          {
            sql: 'DELETE FROM session_movie_feedback WHERE session_id = ?',
            args: [session.id],
          },
          ...feedbackEntries.map((entry) => ({
            sql: `INSERT INTO session_movie_feedback (id, session_id, movie_id, feedback, created_at)
              VALUES (?, ?, ?, ?, ?)`,
            args: [randomUUID(), session.id, entry.movieId, entry.feedback, new Date(nowMs).toISOString()],
          })),
        ],
        'write',
      );

      return true;
    },
    async touchSession(sessionId, profileId, nowMs, expiresAtMs) {
      const result = await databaseClient.execute({
        sql: `UPDATE sessions
          SET updated_at = ?, expires_at_ms = ?
          WHERE id = ? AND profile_id = ? AND status = 'active' AND expires_at_ms > ?`,
        args: [new Date(nowMs).toISOString(), expiresAtMs, sessionId, profileId, nowMs],
      });

      return result.rowsAffected === 1;
    },
    async touchProfile(profileId, nowMs, expiresAtMs) {
      const result = await databaseClient.execute({
        sql: `UPDATE anonymous_profiles
          SET last_seen_at_ms = ?, expires_at_ms = ?
          WHERE id = ? AND invalidated_at_ms IS NULL AND expires_at_ms > ?`,
        args: [nowMs, expiresAtMs, profileId, nowMs],
      });

      return result.rowsAffected === 1;
    },
  };
}

function historyEntries(history: ViewerHistory): Array<{ feedback: 'watched' | 'liked' | 'disliked'; movieId: string }> {
  const normalized = normalizeHistory(history);
  const feedbackByMovieId = new Map<string, 'watched' | 'liked' | 'disliked'>();

  for (const movieId of normalized.watched) {
    feedbackByMovieId.set(movieId, 'watched');
  }

  for (const movieId of normalized.liked) {
    feedbackByMovieId.set(movieId, 'liked');
  }

  for (const movieId of normalized.disliked) {
    feedbackByMovieId.set(movieId, 'disliked');
  }

  return Array.from(feedbackByMovieId, ([movieId, feedback]) => ({ feedback, movieId }));
}

function historyFromRows(rows: Array<Record<string, unknown>>): ViewerHistory {
  const watched = new Set<string>();
  const liked = new Set<string>();
  const disliked = new Set<string>();

  for (const row of rows) {
    const movieId = String(row.movie_id ?? '');

    if (movieId.length === 0) {
      continue;
    }

    watched.add(movieId);

    if (row.feedback === 'liked') {
      liked.add(movieId);
      disliked.delete(movieId);
    }

    if (row.feedback === 'disliked') {
      disliked.add(movieId);
      liked.delete(movieId);
    }
  }

  return { disliked: Array.from(disliked), liked: Array.from(liked), watched: Array.from(watched) };
}

function groupFeedbackBySessionId(rows: Array<Record<string, unknown>>): Map<string, Array<Record<string, unknown>>> {
  const feedbackBySessionId = new Map<string, Array<Record<string, unknown>>>();

  for (const row of rows) {
    const sessionId = String(row.session_id ?? '');

    if (sessionId.length === 0) {
      continue;
    }

    const feedback = feedbackBySessionId.get(sessionId) ?? [];
    feedback.push(row);
    feedbackBySessionId.set(sessionId, feedback);
  }

  return feedbackBySessionId;
}

function groupRecommendationsByRoundId(rows: Array<Record<string, unknown>>): Map<string, StoredRecommendationImpression[]> {
  const recommendationsByRoundId = new Map<string, StoredRecommendationImpression[]>();

  for (const row of rows) {
    const roundId = String(row.round_id ?? '');
    const movieId = String(row.movie_id ?? '');
    const score = Number(row.score);

    if (roundId.length === 0 || movieId.length === 0 || !Number.isFinite(score)) {
      continue;
    }

    const recommendations = recommendationsByRoundId.get(roundId) ?? [];
    recommendations.push({ movieId, score });
    recommendationsByRoundId.set(roundId, recommendations);
  }

  return recommendationsByRoundId;
}

function normalizeHistory(history: ViewerHistory): ViewerHistory {
  const liked = new Set(history.liked);
  const disliked = new Set(history.disliked.filter((movieId) => !liked.has(movieId)));
  const watched = new Set([...history.watched, ...liked, ...disliked]);

  return { disliked: Array.from(disliked), liked: Array.from(liked), watched: Array.from(watched) };
}

function preferencesFromRow(row: Record<string, unknown> | undefined): Preferences {
  const runtime = row?.runtime_preference;

  return {
    freeText: typeof row?.free_text === 'string' ? row.free_text : '',
    genres: parseStringArray(row?.genres_json),
    runtime: runtime === 'short' || runtime === 'medium' || runtime === 'long' ? runtime : 'any',
  };
}

function parseStringArray(value: unknown): string[] {
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

function toStoredSession(session: NewSession, roundId: string): StoredSession {
  return {
    createdAt: session.createdAt,
    expiresAtMs: session.expiresAtMs,
    history: session.history,
    id: session.id,
    preferences: session.preferences,
    profileId: session.profileId,
    roundId,
  };
}
