import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createClient, type Client } from '@libsql/client';
import { createSqlMovieCatalogRepository } from './movies.repository.js';

const CATALOG_SIZE = 501;

describe('repositório do catálogo de filmes', () => {
  it('deve carregar o catálogo em mais de uma página sem perder gêneros', async () => {
    const context = await createTestContext();

    try {
      await seedCatalog(context.client);

      const catalog = await createSqlMovieCatalogRepository(context.client).listRankingCandidates();

      assert.equal(catalog.length, CATALOG_SIZE + 1);
      assert.deepEqual(catalog.find((movie) => movie.id === 'movie-0000')?.genres, ['Drama']);
      assert.deepEqual(catalog.find((movie) => movie.id === 'movie-0000')?.modelFeatures, {
        ratingCount: 12,
        ratingStddev: 1.25,
        voteAverage: 8.5,
      });
      assert.deepEqual(catalog.find((movie) => movie.id === 'movie-0500')?.genres, ['Comédia']);
      assert.equal(catalog.find((movie) => movie.id === 'movie-0500')?.modelFeatures, undefined);
      assert.equal(catalog.find((movie) => movie.id === 'empty-title'), undefined);
      assert.equal(catalog[0]?.description, '');
    } finally {
      await context.dispose();
    }
  });

  it('deve listar gêneros sem carregar o catálogo inteiro', async () => {
    const context = await createTestContext();

    try {
      await seedCatalog(context.client);

      const genres = await createSqlMovieCatalogRepository(context.client).listGenres();

      assert.deepEqual(genres, ['Comédia', 'Drama']);
    } finally {
      await context.dispose();
    }
  });

  it('deve hidratar os filmes solicitados mantendo a ordem informada', async () => {
    const context = await createTestContext();

    try {
      await seedCatalog(context.client);

      const movies = await createSqlMovieCatalogRepository(context.client).findByIds(['movie-0500', 'movie-0000']);

      assert.deepEqual(movies.map((movie) => movie.id), ['movie-0500', 'movie-0000']);
      assert.equal(movies[0]?.description, '');
      assert.equal(movies[1]?.title, 'Filme 0');
    } finally {
      await context.dispose();
    }
  });

  it('deve usar o título original e ignorar registros inválidos', async () => {
    const context = await createTestContext();

    try {
      await seedCatalog(context.client);

      const movies = await createSqlMovieCatalogRepository(context.client).findByIds(['fallback-title', 'empty-title']);

      assert.deepEqual(movies.map((movie) => movie.id), ['fallback-title']);
      assert.equal(movies[0]?.title, 'Título alternativo');
    } finally {
      await context.dispose();
    }
  });
});

async function createTestContext() {
  const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-movies-'));
  const client = createClient({ url: `file:${join(directory, 'database.db')}` });
  await client.executeMultiple(await readFile('packages/database/src/schema.sql', 'utf8'));

  return {
    client,
    dispose: async () => {
      await client.close();
      await rm(directory, { force: true, recursive: true });
    },
  };
}

async function seedCatalog(client: Client): Promise<void> {
  const statements = [
    ...Array.from({ length: CATALOG_SIZE }, (_, index) => {
    const id = `movie-${String(index).padStart(4, '0')}`;
    const genre = index === CATALOG_SIZE - 1 ? 'Comédia' : 'Drama';

    return [
      {
        args: [id, `${id}-tmdb`, `Filme ${index}`, `Filme ${index}`, 2024, 100, index, index],
        sql: `INSERT INTO movies (
          id, tmdb_id, title, original_title, release_year, runtime_minutes, popularity, vote_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      },
      {
        args: [id, index + 1, genre],
        sql: 'INSERT INTO movie_genres (movie_id, genre_id, genre_name) VALUES (?, ?, ?)',
      },
    ];
    }).flat(),
    {
      args: ['fallback-title', 'fallback-title-tmdb', '', 'Título alternativo', 2024, 100, 1, 1],
      sql: `INSERT INTO movies (
        id, tmdb_id, title, original_title, release_year, runtime_minutes, popularity, vote_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    },
    {
      args: ['empty-title', 'empty-title-tmdb', '', '', 0, 100, 0, 0],
      sql: `INSERT INTO movies (
        id, tmdb_id, title, original_title, release_year, runtime_minutes, popularity, vote_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    },
    {
      args: ['empty-title', 9999, 'Corrompido'],
      sql: 'INSERT INTO movie_genres (movie_id, genre_id, genre_name) VALUES (?, ?, ?)',
    },
    {
      args: [8.5, 'movie-0000'],
      sql: 'UPDATE movies SET vote_average = ? WHERE id = ?',
    },
    {
      args: ['movie-0000', 12, 1.25],
      sql: 'INSERT INTO movie_ratings_stats (movie_id, rating_count, rating_stddev) VALUES (?, ?, ?)',
    },
  ];

  await client.batch(statements, 'write');
}
