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
});
