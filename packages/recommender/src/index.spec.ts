import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import { createRecommendationRanker, getRecommendations, rankRecommendations } from './index.js';

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

  it('deve combinar score normalizado do modelo com regras explicáveis', () => {
    const ranking = rankRecommendations(
      [
        movie({ id: 'popular', popularity: 100, voteCount: 100 }),
        movie({ id: 'modelo', popularity: 1, voteCount: 1 }),
      ],
      { freeText: '', genres: [], runtime: 'any' },
      { watched: [], liked: [], disliked: [] },
      {
        modelScoreProvider: {
          getScores() {
            return {
              modelVersion: 'quality-v1',
              scores: new Map([
                ['modelo', 1],
                ['popular', 0],
              ]),
            };
          },
        },
      },
    );

    assert.equal(ranking.recommendations[0]?.id, 'modelo');
    assert.equal(ranking.modelVersion, 'quality-v1');
    assert.match(ranking.recommendations[0]?.reason ?? '', /boa avaliacao estimada pelo modelo/);
  });

  it('deve enviar somente candidatos elegíveis para o modelo', () => {
    const receivedMovieIds: string[] = [];

    rankRecommendations(
      [
        movie({ id: 'adulto', adult: true }),
        movie({ id: 'assistido' }),
        movie({ id: 'bloqueado' }),
        movie({ id: 'curtido' }),
        movie({ id: 'elegivel' }),
      ],
      { freeText: '', genres: [], runtime: 'any' },
      { watched: ['assistido'], liked: ['curtido'], disliked: ['bloqueado'] },
      {
        modelScoreProvider: {
          getScores(movies) {
            receivedMovieIds.push(...movies.map((movie) => movie.id));
            return { scores: new Map(movies.map((movie) => [movie.id, 0.5])) };
          },
        },
      },
    );

    assert.deepEqual(receivedMovieIds, ['elegivel']);
  });

  it('deve usar a heurística quando o provider do modelo falhar', () => {
    const catalog = [
      movie({ id: 'primeiro', popularity: 20, voteCount: 20 }),
      movie({ id: 'segundo', popularity: 10, voteCount: 10 }),
    ];
    const preferences: Preferences = { freeText: '', genres: [], runtime: 'any' };
    const history: ViewerHistory = { watched: [], liked: [], disliked: [] };
    const fallback = rankRecommendations(catalog, preferences, history);
    const ranking = rankRecommendations(catalog, preferences, history, {
      modelScoreProvider: {
        getScores() {
          throw new Error('modelo indisponível');
        },
      },
    });

    assert.deepEqual(ranking, fallback);
  });

  it('deve usar a heurística quando o lote do modelo tiver score inválido', () => {
    const catalog = [
      movie({ id: 'primeiro', popularity: 20, voteCount: 20 }),
      movie({ id: 'segundo', popularity: 10, voteCount: 10 }),
    ];
    const preferences: Preferences = { freeText: '', genres: [], runtime: 'any' };
    const history: ViewerHistory = { watched: [], liked: [], disliked: [] };
    const fallback = rankRecommendations(catalog, preferences, history);
    const ranking = rankRecommendations(catalog, preferences, history, {
      modelScoreProvider: {
        getScores() {
          return { modelVersion: 'invalid-v1', scores: new Map([['primeiro', Number.NaN]]) };
        },
      },
    });

    assert.deepEqual(ranking, fallback);
  });

  it('deve manter preferências de gênero e duração no cold start', () => {
    const recommendations = getRecommendations(
      [
        movie({ id: 'preferido', genres: ['Ficcao'], popularity: 1, runtime: 100, voteCount: 1 }),
        movie({ id: 'popular', genres: ['Drama'], popularity: 100, runtime: 160, voteCount: 100 }),
      ],
      { freeText: '', genres: ['Ficcao'], runtime: 'medium' },
      { watched: [], liked: [], disliked: [] },
    );

    assert.equal(recommendations[0]?.id, 'preferido');
  });

  it('deve aplicar a política versionada injetada no ranker', () => {
    const ranking = createRecommendationRanker({
      policy: {
        modelScoreReasonThreshold: 0.5,
        recommendationLimit: 1,
        version: 'hybrid-test-v2',
        weights: {
          dislikedGenreMatch: -1,
          likedGenreMatch: 1,
          modelScore: 0,
          preferenceGenreMatch: 0,
          runtimeMatch: 1,
          runtimeMismatch: -1,
        },
      },
    }).rank(
      [
        movie({ id: 'longo', popularity: 1, runtime: 150 }),
        movie({ id: 'curto', popularity: 100, runtime: 80 }),
      ],
      { freeText: '', genres: [], runtime: 'long' },
      { watched: [], liked: [], disliked: [] },
    );

    assert.equal(ranking.rankingVersion, 'hybrid-test-v2');
    assert.deepEqual(ranking.recommendations.map((recommendation) => recommendation.id), ['longo']);
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
