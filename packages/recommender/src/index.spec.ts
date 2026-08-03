import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import { getRecommendations } from './index.js';

describe('getRecommendations', () => {
  it('deve calcular recomendacoes a partir do catalogo informado', () => {
    const catalog = [
      movie({ id: 'drama-base', genres: ['Drama'], popularity: 1, voteCount: 1 }),
      movie({ id: 'ficcao-real', genres: ['Ficcao'], popularity: 1, voteCount: 1 }),
      movie({ id: 'comedia-real', genres: ['Comedia'], popularity: 90, voteCount: 900 }),
    ];

    const recommendations = getRecommendations(
      catalog,
      { freeText: '', genres: ['Ficcao'], runtime: 'any' },
      { watched: ['drama-base'], liked: ['drama-base'], disliked: [] },
    );

    assert.deepEqual(
      recommendations.map((recommendation) => recommendation.id),
      ['ficcao-real', 'comedia-real'],
    );
    assert.equal(recommendations[0]?.score, 2);
  });

  it('deve excluir filmes assistidos e conteudo adulto', () => {
    const catalog = [
      movie({ id: 'assistido', genres: ['Ficcao'], popularity: 100, voteCount: 100 }),
      movie({ id: 'adulto', adult: true, genres: ['Ficcao'], popularity: 99, voteCount: 99 }),
      movie({ id: 'elegivel', genres: ['Drama'], popularity: 1, voteCount: 1 }),
    ];

    const recommendations = getRecommendations(
      catalog,
      { freeText: '', genres: ['Ficcao'], runtime: 'any' },
      { watched: ['assistido'], liked: [], disliked: [] },
    );

    assert.deepEqual(
      recommendations.map((recommendation) => recommendation.id),
      ['elegivel'],
    );
  });

  it('deve ordenar empates por popularidade, votos e identificador', () => {
    const catalog = [
      movie({ id: 'zeta', popularity: 30, voteCount: 100 }),
      movie({ id: 'beta', popularity: 30, voteCount: 200 }),
      movie({ id: 'alfa', popularity: 10, voteCount: 5 }),
      movie({ id: 'gamma', popularity: 10, voteCount: 5 }),
      movie({ id: 'fora-do-limite', popularity: 1, voteCount: 1 }),
    ];

    const recommendations = getRecommendations(
      catalog,
      { freeText: '', genres: [], runtime: 'any' },
      { watched: [], liked: [], disliked: [] },
    );

    assert.deepEqual(
      recommendations.map((recommendation) => recommendation.id),
      ['beta', 'zeta', 'alfa', 'gamma'],
    );
  });
});

function movie(overrides: Partial<Movie>): Movie {
  return {
    id: 'movie-id',
    title: 'Filme de teste',
    year: 2024,
    genres: [],
    runtime: 100,
    adult: false,
    popularity: 0,
    voteCount: 0,
    description: 'Descricao de teste.',
    ...overrides,
  };
}
