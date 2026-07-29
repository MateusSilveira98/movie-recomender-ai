import { createDatabaseClient } from '@pkg/database';
import { logger } from '@pkg/logger';
import { resolveDatasetImportConfiguration, resolveDatasetPaths } from '../infrastructure/configuration/dataset-import.configuration.js';
import { loadDatasetLinks } from '../infrastructure/data/dataset-links.loader.js';
import { importCredits } from '../infrastructure/persistence/importers/credits.importer.js';
import { importMovieFeatures } from '../infrastructure/persistence/importers/features.importer.js';
import { importMovies } from '../infrastructure/persistence/importers/movies.importer.js';
import { importRatingStats } from '../infrastructure/persistence/importers/ratings.importer.js';
import { completeImportRun, failImportRun, findImportSkipReason, startImportRun } from '../infrastructure/persistence/import-run.repository.js';

export async function runDatasetImport(): Promise<void> {
  const configuration = resolveDatasetImportConfiguration();
  const client = createDatabaseClient();
  let runId: string | null = null;

  try {
    logger.info({ component: 'dataset-import', event: 'started', datasetKey: configuration.datasetKey, datasetVersion: configuration.datasetVersion, environment: configuration.environment, force: configuration.force });
    const skipReason = await findImportSkipReason(client, configuration);

    if (skipReason) {
      logger.info({ component: 'dataset-import', event: `skipped_${skipReason}` });
      return;
    }

    runId = `${configuration.datasetKey}:${configuration.environment}:${configuration.datasetVersion}:${Date.now()}`;
    await startImportRun(client, runId, configuration);
    const paths = resolveDatasetPaths();
    logger.info({ component: 'dataset-import', event: 'loading_links' });
    const links = await loadDatasetLinks(paths.linksPath);
    logger.info({ component: 'dataset-import', event: 'links_loaded', movieLensKeys: links.byMovieLensId.size, tmdbKeys: links.byTmdbId.size });
    logger.info({ component: 'dataset-import', event: 'importing_movies' });
    const movieImport = await importMovies(client, paths.moviesMetadataPath, links);
    logger.info({ component: 'dataset-import', event: 'movies_imported', count: movieImport.importedCount });
    logger.info({ component: 'dataset-import', event: 'importing_credits' });
    await importCredits(client, paths.creditsPath, movieImport.knownMovieIds, movieImport.featureDrafts);
    logger.info({ component: 'dataset-import', event: 'credits_imported' });
    logger.info({ component: 'dataset-import', event: 'importing_features' });
    const featuresImported = await importMovieFeatures(client, movieImport.featureDrafts);
    logger.info({ component: 'dataset-import', event: 'features_imported', count: featuresImported });
    logger.info({ component: 'dataset-import', event: 'importing_rating_stats' });
    const ratingStatsImported = await importRatingStats(client, paths.ratingsPath, links.byMovieLensId, movieImport.knownMovieIds);
    logger.info({ component: 'dataset-import', event: 'rating_stats_imported', count: ratingStatsImported });
    await completeImportRun(client, runId, movieImport.importedCount, featuresImported, ratingStatsImported);
    logger.info({ component: 'dataset-import', event: 'completed', featuresImported, moviesImported: movieImport.importedCount, ratingStatsImported });
  } catch (error) {
    if (runId) {
      await failImportRun(client, runId, getErrorMessage(error));
    }

    logger.error({ component: 'dataset-import', event: 'failed', error: getErrorName(error) });
    throw error;
  } finally {
    await client.close();
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha desconhecida durante a importacao.';
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
