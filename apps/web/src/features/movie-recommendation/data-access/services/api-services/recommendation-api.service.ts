import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { RecommendationRound } from '@pkg/shared/entities/models/recommendation-round.model';
import type { Session } from '@pkg/shared/entities/models/session.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { RuntimePreference } from '@pkg/shared/entities/types/runtime-preference.type';
import { API_BASE_URL } from '../../../entities/consts/api-base-url.const';
import type { SessionRecommendation } from '../../../entities/models/session-recommendation.model';

let csrfToken: string | null = null;
let csrfTokenRequest: Promise<void> | null = null;

export type { SessionRecommendation } from '../../../entities/models/session-recommendation.model';

export interface AnonymousProfileResponse {
  preferences: Preferences;
  history: ViewerHistory;
}

export interface SessionStateResponse {
  profile: AnonymousProfileResponse;
  session: Session | null;
  recommendations: SessionRecommendation[];
  csrfToken: string;
}

export interface CurrentSessionResponse extends SessionStateResponse {
  rounds: RecommendationRound[];
}

interface RecommendationsResponse {
  recommendations: SessionRecommendation[];
  csrfToken?: string;
}

interface FeedbackResponse extends RecommendationsResponse {
  session: Session;
}

export interface MovieCatalogFilter {
  genres: string[];
  runtime: RuntimePreference;
  limit: number;
}

export async function fetchGenreOptions(): Promise<string[]> {
  const body = await requestJson<{ genres: string[] }>('/genres');
  return body.genres;
}

export async function fetchMovieCatalog(filter?: MovieCatalogFilter): Promise<Movie[]> {
  const query = buildMovieQuery(filter);
  const body = await requestJson<{ movies: Movie[] }>(`/movies${query}`);
  return body.movies;
}

function buildMovieQuery(filter?: MovieCatalogFilter): string {
  if (!filter) {
    return '';
  }

  const params = new URLSearchParams();

  if (filter.genres.length > 0) {
    params.set('genres', filter.genres.join(','));
  }

  params.set('runtime', filter.runtime);
  params.set('limit', String(filter.limit));

  return `?${params.toString()}`;
}

export function fetchCurrentSession(): Promise<CurrentSessionResponse> {
  return requestJson<CurrentSessionResponse>('/sessions/current');
}

export async function createRecommendationSession(
  request: { preferences: Preferences; history?: ViewerHistory },
): Promise<SessionStateResponse> {
  return requestJson<SessionStateResponse>('/sessions', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function fetchSessionRecommendations(): Promise<SessionRecommendation[]> {
  const body = await requestJson<RecommendationsResponse>('/sessions/recommendations', { method: 'POST' });
  return body.recommendations;
}

export function sendSessionFeedback(request: { impressionId: string; feedback: 'liked' | 'disliked' }): Promise<FeedbackResponse> {
  return requestJson<FeedbackResponse>('/sessions/feedback', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';

  if (method !== 'GET' && !csrfToken) {
    await ensureCsrfToken();
  }

  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (method !== 'GET' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  const responseBody = await parseJsonSafely(response);

  updateCsrfToken(responseBody);

  if (!response.ok) {
    throw new Error(resolveErrorMessage(responseBody, path));
  }

  return responseBody as T;
}

async function ensureCsrfToken(): Promise<void> {
  if (csrfToken) {
    return;
  }

  csrfTokenRequest ??= fetchCurrentSession()
    .then(() => undefined)
    .finally(() => {
      csrfTokenRequest = null;
    });

  await csrfTokenRequest;

  if (!csrfToken) {
    throw new Error('Nao foi possivel iniciar a sessao segura. Atualize a pagina e tente novamente.');
  }
}

function updateCsrfToken(body: unknown): void {
  if (typeof body !== 'object' || body === null) {
    return;
  }

  const token = (body as { csrfToken?: unknown }).csrfToken;

  if (typeof token === 'string' && token.length > 0) {
    csrfToken = token;
  }
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveErrorMessage(body: unknown, path: string): string {
  if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }

  return `Falha ao chamar ${path}.`;
}
