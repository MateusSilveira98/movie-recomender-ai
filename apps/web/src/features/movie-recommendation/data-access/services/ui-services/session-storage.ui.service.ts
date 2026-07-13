import type { Preferences } from '@movie-recomender-ai/shared/entities/models/preferences.model';
import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';
import type { Mood } from '@movie-recomender-ai/shared/entities/types/mood.type';
import type { RuntimePreference } from '@movie-recomender-ai/shared/entities/types/runtime-preference.type';
import { DEFAULT_HISTORY, DEFAULT_PREFERENCES } from '../../../entities/consts/defaults.const';
import { STORAGE_KEY } from '../../../entities/consts/storage.const';
import type { RecommendationRound, StoredSession } from './movie-session.ui.service';

type LegacyPreferences = Partial<Preferences> & {
  maxRuntime?: number;
  mood?: Mood;
};

type LegacyRecommendationRound = Partial<Omit<RecommendationRound, 'preferences' | 'history'>> & {
  history?: Partial<ViewerHistory>;
  preferences?: LegacyPreferences;
};

type LegacyStoredSession = Partial<Omit<StoredSession, 'preferences' | 'history' | 'rounds'>> & {
  history?: Partial<ViewerHistory>;
  preferences?: LegacyPreferences;
  rounds?: LegacyRecommendationRound[];
};

export function loadStoredSession(): StoredSession | null {
  const rawSession = window.localStorage.getItem(STORAGE_KEY);

  if (!rawSession) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(rawSession) as LegacyStoredSession;

    if (!parsedSession.preferences || !parsedSession.history) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return {
      preferences: normalizePreferences(parsedSession.preferences),
      history: normalizeHistory(parsedSession.history),
      rounds: (parsedSession.rounds ?? []).map(normalizeRound).filter(isRecommendationRound),
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveStoredSession(session: StoredSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function normalizeRound(round: LegacyRecommendationRound): RecommendationRound | null {
  if (!round.preferences || !round.history || !round.recommendations) {
    return null;
  }

  return {
    id: round.id ?? `round-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: round.createdAt ?? new Date().toISOString(),
    preferences: normalizePreferences(round.preferences),
    history: normalizeHistory(round.history),
    recommendations: round.recommendations,
  };
}

function normalizePreferences(preferences: LegacyPreferences): Preferences {
  return {
    freeText: preferences.freeText ?? DEFAULT_PREFERENCES.freeText,
    genres: [...(preferences.genres ?? DEFAULT_PREFERENCES.genres)],
    moods: [...(preferences.moods ?? (preferences.mood ? [preferences.mood] : DEFAULT_PREFERENCES.moods))],
    runtime: preferences.runtime ?? resolveLegacyRuntime(preferences.maxRuntime),
  };
}

function normalizeHistory(history: Partial<ViewerHistory>): ViewerHistory {
  return {
    watched: history.watched ?? DEFAULT_HISTORY.watched,
    liked: history.liked ?? DEFAULT_HISTORY.liked,
    disliked: history.disliked ?? DEFAULT_HISTORY.disliked,
  };
}

function resolveLegacyRuntime(maxRuntime: number | undefined): RuntimePreference {
  if (!maxRuntime) {
    return DEFAULT_PREFERENCES.runtime;
  }

  if (maxRuntime <= 90) {
    return 'short';
  }

  if (maxRuntime <= 120) {
    return 'medium';
  }

  return 'long';
}

function isRecommendationRound(round: RecommendationRound | null): round is RecommendationRound {
  return round !== null;
}
