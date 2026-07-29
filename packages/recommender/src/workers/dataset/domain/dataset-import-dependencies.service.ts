import type { DatasetDependency, DatasetFileType } from './dataset-import-queue.types.js';

export function resolveMissingDatasetDependencies(type: DatasetFileType, available: { links: number; movies: number }): DatasetDependency[] {
  const dependencies: DatasetDependency[] = [];

  if ((type === 'credits' || type === 'ratings') && available.movies === 0) {
    dependencies.push({ reason: 'O arquivo requer filmes cadastrados.', type: 'movies' });
  }

  if (type === 'ratings' && available.links === 0) {
    dependencies.push({ reason: 'O arquivo requer vinculos MovieLens para TMDB.', type: 'links' });
  }

  return dependencies;
}
