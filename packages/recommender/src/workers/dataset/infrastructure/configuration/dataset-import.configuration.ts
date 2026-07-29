import { resolve } from 'node:path';
import type { DatasetImportConfiguration, DatasetPaths } from '../../domain/dataset.types.js';

export function resolveDatasetImportConfiguration(): DatasetImportConfiguration {
  return {
    datasetKey: process.env.DATASET_IMPORT_KEY ?? 'tmdb-movielens',
    datasetVersion: process.env.DATASET_IMPORT_VERSION ?? 'v1',
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'local',
    force: process.env.DATASET_IMPORT_FORCE === 'true',
  };
}

export function resolveDatasetPaths(): DatasetPaths {
  const datasetDir = process.env.MOVIES_DATASET_DIR ?? process.env.MOVIE_DATASET_DIR ?? '/Users/mateus.costa/Projects/IA/MoviesDataset';

  return {
    creditsPath: process.env.MOVIES_CREDITS_CSV ?? resolve(datasetDir, 'credits.csv'),
    linksPath: process.env.MOVIES_LINKS_CSV ?? resolve(datasetDir, 'links.csv'),
    moviesMetadataPath: process.env.MOVIES_METADATA_CSV ?? resolve(datasetDir, 'movies_metadata.csv'),
    ratingsPath: process.env.MOVIES_RATINGS_CSV ?? resolve(datasetDir, 'ratings_small.csv'),
  };
}
