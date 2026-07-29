import type { Client } from '@libsql/client';
import { parsePositiveInteger, readCsv } from './csv.reader.js';
import type { DatasetLinks, LinkRecord } from '../../domain/dataset.types.js';

export async function loadDatasetLinks(filePath: string): Promise<DatasetLinks> {
  const byMovieLensId = new Map<number, LinkRecord>();
  const byTmdbId = new Map<number, LinkRecord>();

  for await (const row of readCsv(filePath)) {
    const movieLensId = parsePositiveInteger(row.movieId);
    const movieId = parsePositiveInteger(row.tmdbId);

    if (movieLensId === null || movieId === null) {
      continue;
    }

    const link = { movieId, movieLensId };
    byMovieLensId.set(movieLensId, link);
    byTmdbId.set(movieId, link);
  }

  return { byMovieLensId, byTmdbId };
}

export async function loadStoredDatasetLinks(client: Client): Promise<DatasetLinks> {
  const result = await client.execute('SELECT movie_lens_id, tmdb_id FROM dataset_movie_links');
  const byMovieLensId = new Map<number, LinkRecord>();
  const byTmdbId = new Map<number, LinkRecord>();

  for (const row of result.rows) {
    const movieLensId = Number(row.movie_lens_id);
    const movieId = Number(row.tmdb_id);

    if (!Number.isInteger(movieLensId) || !Number.isInteger(movieId)) {
      continue;
    }

    const link = { movieId, movieLensId };
    byMovieLensId.set(movieLensId, link);
    byTmdbId.set(movieId, link);
  }

  return { byMovieLensId, byTmdbId };
}
