import { createApp } from './app/app.js';
import { createDatabaseClient, applyDatabaseSchema } from '@pkg/database';
import { logger } from '@pkg/logger';
import { loadModelRuntimeFromEnvironment } from '@pkg/ml';
import { recordActiveModel, startObservability } from '@pkg/observability';
import { createRecommendationRanker } from '@pkg/recommender';

async function bootstrap(): Promise<void> {
  const observabilityEnabled = await startObservability({ serviceName: 'bff' });
  const databaseClient = createDatabaseClient();
  await applyDatabaseSchema(databaseClient);
  const modelRuntime = await loadModelRuntimeFromEnvironment();
  recordActiveModel({ mode: modelRuntime.status.mode, modelVersion: modelRuntime.status.modelVersion });
  const app = createApp({
    databaseClient,
    mlStatus: modelRuntime.status,
    recommendationRanker: createRecommendationRanker({ modelScoreProvider: modelRuntime.modelScoreProvider }),
  });

  const port = Number(process.env.PORT ?? 3333);

  app.listen(port, () => {
    logger.info({
      component: 'bff',
      event: 'started',
      observabilityEnabled,
      mlMode: modelRuntime.status.mode,
      mlStatus: modelRuntime.status.status,
      modelVersion: modelRuntime.status.modelVersion ?? null,
      port,
    });
  });
}

void bootstrap();
