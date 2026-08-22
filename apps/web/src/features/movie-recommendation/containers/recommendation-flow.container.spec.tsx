import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../app/app';
import { currentSessionResponse, createSession, history, recommendation } from '../../../test/recommendation-fixtures';
import { jsonResponse, mockHttp } from '../../../test/http-mock';

describe('recommendation journey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('when an active session exists', () => {
    it('shows the recommendations restored from the current session', async () => {
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse()),
      }));

      render(<App />);

      expect(await screen.findByText('Horizonte (2024)')).toBeTruthy();
      expect(screen.getByText('91% match')).toBeTruthy();
    });

    it('shows an empty state when the session has no recommendations', async () => {
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: [] }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse({ recommendations: [] })),
      }));

      render(<App />);

      expect(await screen.findByText(/Nenhuma recomendacao encontrada/)).toBeTruthy();
    });
  });

  describe('when no active session exists', () => {
    it('allows a new journey to start', async () => {
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse({ session: null })),
      }));

      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByRole('button', { name: 'Avancar' }));

      expect(await screen.findByText('Quais preferencias importam hoje?')).toBeTruthy();
    });
  });

  describe('when loading genres fails', () => {
    it('shows a recoverable error and loads the options after retrying', async () => {
      let genreRequests = 0;
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => {
          genreRequests += 1;
          return genreRequests === 1
            ? jsonResponse({ error: 'Generos indisponiveis.' }, 503)
            : jsonResponse({ genres: ['Ficcao cientifica'] });
        },
        'GET /sessions/current': () => jsonResponse(currentSessionResponse({ session: null })),
      }));

      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Avancar' }));

      expect(await screen.findByText('Nao foi possivel carregar os generos da API.')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));

      expect(await screen.findByRole('button', { name: 'Ficcao cientifica' })).toBeTruthy();
    });
  });

  describe('when loading the movie catalog fails', () => {
    it('shows a recoverable error and loads the catalog after retrying', async () => {
      let catalogRequests = 0;
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
        'GET /movies?genres=Ficcao+cientifica&runtime=medium&limit=10': () => {
          catalogRequests += 1;
          return catalogRequests === 1
            ? jsonResponse({ error: 'Catalogo indisponivel.' }, 503)
            : jsonResponse({ movies: [recommendation] });
        },
        'GET /sessions/current': () => jsonResponse(currentSessionResponse({ session: null })),
      }));

      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Avancar' }));
      await user.click(await screen.findByRole('button', { name: 'Continuar' }));

      expect(await screen.findByText('Nao foi possivel carregar o catalogo de filmes da API.')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));

      expect(await screen.findByRole('checkbox', { name: /Horizonte/ })).toBeTruthy();
    });
  });

  describe('when navigating back from watched movies', () => {
    it('preserves the selected preferences', async () => {
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica', 'Drama'] }),
        'GET /movies?genres=Ficcao+cientifica&runtime=medium&limit=10': () => jsonResponse({ movies: [recommendation] }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse({ session: null })),
      }));

      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Avancar' }));
      await screen.findByRole('button', { name: 'Ficcao cientifica' });
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await screen.findByRole('checkbox', { name: /Horizonte/ });

      await user.click(screen.getByRole('button', { name: 'Voltar' }));

      expect((await screen.findByRole('button', { name: 'Continuar' })).hasAttribute('disabled')).toBe(false);
    });
  });

  describe('when creating a recommendation round', () => {
    it('sends the selected preferences and history', async () => {
      const requestLog: Array<{ body: string | null; csrf: string | null }> = [];
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
        'GET /movies?genres=Ficcao+cientifica&runtime=medium&limit=10': () => jsonResponse({
          movies: [{
            adult: false,
            description: 'Uma tripulação procura um novo lar.',
            genres: ['Ficcao cientifica'],
            id: 'movie-1',
            popularity: 10,
            runtime: 120,
            title: 'Horizonte',
            voteCount: 50,
            year: 2024,
          }]
        }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse({ session: null })),
        'POST /sessions': (request) => {
          requestLog.push({ body: request.body, csrf: request.headers.get('X-CSRF-Token') });
          return jsonResponse(currentSessionResponse({ csrfToken: 'csrf-created' }));
        },
      }));

      const user = userEvent.setup();
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Avancar' }));
      await screen.findByRole('button', { name: 'Ficcao cientifica' });
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await user.click(await screen.findByRole('checkbox', { name: /Horizonte/ }));
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await user.click(await screen.findByRole('button', { name: 'Gostei' }));
      await user.click(screen.getByRole('button', { name: 'Ver recomendacoes' }));

      expect(await screen.findByText('Horizonte (2024)')).toBeTruthy();
      expect(requestLog.map((request) => ({
        body: request.body ? JSON.parse(request.body) : null,
        csrf: request.csrf,
      }))).toEqual([{
        body: {
          history: { disliked: [], liked: ['movie-1'], watched: ['movie-1'] },
          preferences: { freeText: '', genres: ['Ficcao cientifica'], runtime: 'medium' },
        },
        csrf: 'csrf-current',
      }]);
    });
  });

  describe('when submitting feedback', () => {
    it('updates the visible result with CSRF protection', async () => {
      const feedbackHistory = { ...history, liked: [recommendation.id] };
      const requestLog: Array<{ body: string | null; csrf: string | null }> = [];
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse({ csrfToken: 'csrf-current' })),
        'POST /sessions/feedback': (request) => {
          requestLog.push({ body: request.body, csrf: request.headers.get('X-CSRF-Token') });
          return jsonResponse({
            csrfToken: 'csrf-after-feedback',
            recommendations: [recommendation],
            session: createSession(feedbackHistory),
          });
        },
      }));

      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Horizonte (2024)');

      await user.click(screen.getByRole('button', { name: 'Gostei de Horizonte' }));

      expect(await screen.findByRole('tab', { name: 'Gostei (1)' })).toBeTruthy();
      expect(requestLog.map((request) => ({
        body: request.body ? JSON.parse(request.body) : null,
        csrf: request.csrf,
      }))).toEqual([{
        body: { feedback: 'liked', impressionId: 'impression-1' },
        csrf: 'csrf-current',
      }]);
    });

    it('shows a recoverable error when the API rejects feedback', async () => {
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse()),
        'POST /sessions/feedback': () => jsonResponse({ error: 'Nao foi possivel salvar sua opiniao.' }, 500),
      }));

      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Horizonte (2024)');

      await user.click(screen.getByRole('button', { name: 'Nao gostei de Horizonte' }));

      expect(await screen.findByText('Nao foi possivel salvar sua opiniao.')).toBeTruthy();
    });
  });

  describe('when viewing an existing recommendation round', () => {
    it('shows feedback and round history in their respective tabs', async () => {
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse({
          session: createSession({ disliked: [], liked: ['movie-1'], watched: ['movie-1'] }),
        })),
      }));

      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Horizonte (2024)');

      await user.click(screen.getByRole('tab', { name: 'Gostei (1)' }));
      expect(await screen.findByText('Filmes que vc marcou como gostei')).toBeTruthy();

      await user.click(screen.getByRole('tab', { name: 'Historico (1)' }));
      expect(await screen.findByText('Rodada 1')).toBeTruthy();
    });

    it('starts a new round with the preference step', async () => {
      vi.stubGlobal('fetch', mockHttp({
        'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
        'GET /sessions/current': () => jsonResponse(currentSessionResponse()),
      }));

      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Horizonte (2024)');

      await user.click(screen.getByRole('button', { name: 'Nova rodada' }));

      expect(await screen.findByText('Quais preferencias importam hoje?')).toBeTruthy();
    });
  });
});
