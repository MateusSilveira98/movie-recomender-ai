import type { CreateSessionRequest } from '@movie-recomender-ai/shared/entities/models/create-session-request.model';
import type { Movie } from '@movie-recomender-ai/shared/entities/models/movie.model';
import type { Recommendation } from '@movie-recomender-ai/shared/entities/models/recommendation.model';
import type { Session } from '@movie-recomender-ai/shared/entities/models/session.model';
import type { SessionFeedbackRequest } from '@movie-recomender-ai/shared/entities/models/session-feedback-request.model';
import type { RuntimePreference } from '@movie-recomender-ai/shared/entities/types/runtime-preference.type';
import { API_BASE_URL } from '../../../entities/consts/api-base-url.const';

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

export async function createRecommendationSession(request: CreateSessionRequest): Promise<Session> {
  const body = await requestJson<{ session: Session }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return body.session;
}

export async function fetchSessionRecommendations(sessionId: string): Promise<Recommendation[]> {
  const body = await requestJson<{ recommendations: Recommendation[] }>(
    `/sessions/${sessionId}/recommendations`,
    { method: 'POST' },
  );
  return body.recommendations;
}

export async function sendSessionFeedback(sessionId: string, request: SessionFeedbackRequest): Promise<Session> {
  const body = await requestJson<{ session: Session }>(`/sessions/${sessionId}/feedback`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return body.session;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const responseBody = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(resolveErrorMessage(responseBody, path));
  }

  return responseBody as T;
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
