import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSessionResponse, recommendation } from '../../../../../test/recommendation-fixtures';
import { jsonResponse, mockHttp } from '../../../../../test/http-mock';

describe('API de recomendação', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('deve enviar uma nova sessão com cookie, CSRF e o perfil selecionado', async () => {
    const requestLog: Array<{ body: string | null; credentials: RequestCredentials | undefined; csrf: string | null }> = [];
    vi.stubGlobal('fetch', mockHttp({
      'GET /sessions/current': () => jsonResponse(currentSessionResponse({ csrfToken: 'csrf-session' })),
      'POST /sessions': (request) => {
        requestLog.push({
          body: request.body,
          credentials: request.credentials,
          csrf: request.headers.get('X-CSRF-Token'),
        });
        return jsonResponse(currentSessionResponse({ csrfToken: 'csrf-created' }));
      },
    }));
    const { createRecommendationSession } = await import('./recommendation-api.service');

    const result = await createRecommendationSession({
      history: { disliked: [], liked: [], watched: ['movie-1'] },
      preferences: { freeText: '', genres: ['Ficcao cientifica'], runtime: 'medium' },
    });

    expect(result.session?.createdAt).toBe('2026-08-22T12:00:00.000Z');
    expect(requestLog).toEqual([{
      body: JSON.stringify({
        history: { disliked: [], liked: [], watched: ['movie-1'] },
        preferences: { freeText: '', genres: ['Ficcao cientifica'], runtime: 'medium' },
      }),
      credentials: 'include',
      csrf: 'csrf-session',
    }]);
  });

  it('deve devolver o erro informado pela API quando o catálogo falha', async () => {
    vi.stubGlobal('fetch', mockHttp({
      'GET /movies': () => jsonResponse({ error: 'Catalogo indisponivel.' }, 503),
    }));
    const { fetchMovieCatalog } = await import('./recommendation-api.service');

    await expect(fetchMovieCatalog()).rejects.toThrow('Catalogo indisponivel.');
  });

  it('deve consultar o catálogo com os filtros selecionados e devolver os filmes recebidos', async () => {
    vi.stubGlobal('fetch', mockHttp({
      'GET /movies?genres=Ficcao+cientifica&runtime=medium&limit=10': (request) => {
        expect(request.credentials).toBe('include');
        return jsonResponse({ movies: [recommendation] });
      },
    }));
    const { fetchMovieCatalog } = await import('./recommendation-api.service');

    const movies = await fetchMovieCatalog({
      genres: ['Ficcao cientifica'],
      limit: 10,
      runtime: 'medium',
    });

    expect(movies).toEqual([recommendation]);
  });
});
