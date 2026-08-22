import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Session } from '@pkg/shared/entities/models/session.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { CurrentSessionResponse } from '../features/movie-recommendation/data-access/services/api-services/recommendation-api.service';
import type { SessionRecommendation } from '../features/movie-recommendation/entities/models/session-recommendation.model';

export const preferences: Preferences = {
  freeText: '',
  genres: ['Ficcao cientifica'],
  runtime: 'medium',
};

export const history: ViewerHistory = {
  disliked: [],
  liked: [],
  watched: [],
};

export const recommendation: SessionRecommendation = {
  adult: false,
  description: 'Uma tripulação procura um novo lar.',
  genres: ['Ficcao cientifica'],
  id: 'movie-1',
  impressionId: 'impression-1',
  matchPercentage: 91,
  popularity: 10,
  reason: 'Combina com seu interesse em ficcao cientifica',
  runtime: 120,
  score: 0.91,
  title: 'Horizonte',
  voteCount: 50,
  year: 2024,
};

export function createSession(nextHistory: ViewerHistory = history): Session {
  return {
    createdAt: '2026-08-22T12:00:00.000Z',
    history: nextHistory,
    preferences,
  };
}

export function currentSessionResponse(input: {
  recommendations?: SessionRecommendation[];
  session?: Session | null;
  csrfToken?: string;
} = {}): CurrentSessionResponse {
  const session = input.session === undefined ? createSession() : input.session;
  const profile = session ?? createSession();
  const recommendations = input.recommendations ?? (session ? [recommendation] : []);

  return {
    csrfToken: input.csrfToken ?? 'csrf-current',
    profile: { history: profile.history, preferences: profile.preferences },
    recommendations,
    rounds: session ? [{
      createdAt: session.createdAt,
      history: session.history,
      movieTitles: Object.fromEntries(recommendations.map((item) => [item.id, item.title])),
      preferences: session.preferences,
      recommendations,
    }] : [],
    session,
  };
}
