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
