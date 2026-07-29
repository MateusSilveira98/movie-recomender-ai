import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveMissingDatasetDependencies } from './dataset-import-dependencies.service.js';

describe('dependencias de importacao do dataset', () => {
  it('deve permitir importar links sem filmes existentes', () => {
    const dependencies = resolveMissingDatasetDependencies('links', { links: 0, movies: 0 });

    assert.deepEqual(dependencies, []);
  });

  it('deve informar que creditos aguardam filmes', () => {
    const dependencies = resolveMissingDatasetDependencies('credits', { links: 0, movies: 0 });

    assert.deepEqual(dependencies, [{ reason: 'O arquivo requer filmes cadastrados.', type: 'movies' }]);
  });

  it('deve informar que ratings aguardam filmes e links', () => {
    const dependencies = resolveMissingDatasetDependencies('ratings', { links: 0, movies: 0 });

    assert.deepEqual(dependencies, [
      { reason: 'O arquivo requer filmes cadastrados.', type: 'movies' },
      { reason: 'O arquivo requer vinculos MovieLens para TMDB.', type: 'links' },
    ]);
  });
});
