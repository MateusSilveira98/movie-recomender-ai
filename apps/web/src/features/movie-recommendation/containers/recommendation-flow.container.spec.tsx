import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../app/app';
import { currentSessionResponse, createSession, history, recommendation } from '../../../test/recommendation-fixtures';
import { jsonResponse, mockHttp } from '../../../test/http-mock';

describe('jornada de recomendação', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deve exibir as recomendações restauradas da sessão atual', async () => {
    vi.stubGlobal('fetch', mockHttp({
      'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
      'GET /sessions/current': () => jsonResponse(currentSessionResponse()),
    }));

    render(<App />);

    expect(await screen.findByText('Horizonte (2024)')).toBeTruthy();
    expect(screen.getByText('91% match')).toBeTruthy();
  });

  it('deve exibir estado vazio quando a sessão não recebe recomendações', async () => {
    vi.stubGlobal('fetch', mockHttp({
      'GET /genres': () => jsonResponse({ genres: [] }),
      'GET /sessions/current': () => jsonResponse(currentSessionResponse({ recommendations: [] })),
    }));

    render(<App />);

    expect(await screen.findByText(/Nenhuma recomendacao encontrada/)).toBeTruthy();
  });

  it('deve permitir iniciar uma nova jornada quando não existe sessão ativa', async () => {
    vi.stubGlobal('fetch', mockHttp({
      'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
      'GET /sessions/current': () => jsonResponse(currentSessionResponse({ session: null })),
    }));

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Avancar' }));

    expect(await screen.findByText('Quais preferencias importam hoje?')).toBeTruthy();
  });

  it('deve criar uma rodada com as preferências e o histórico selecionados', async () => {
    const requestLog: Array<{ body: string | null; csrf: string | null }> = [];
    vi.stubGlobal('fetch', mockHttp({
      'GET /genres': () => jsonResponse({ genres: ['Ficcao cientifica'] }),
      'GET /movies?genres=Ficcao+cientifica&runtime=medium&limit=10': () => jsonResponse({ movies: [{
        adult: false,
        description: 'Uma tripulação procura um novo lar.',
        genres: ['Ficcao cientifica'],
        id: 'movie-1',
        popularity: 10,
        runtime: 120,
        title: 'Horizonte',
        voteCount: 50,
        year: 2024,
      }] }),
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

  it('deve atualizar o resultado visível após enviar feedback com CSRF', async () => {
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

  it('deve informar erro recuperável quando o feedback é recusado pela API', async () => {
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
