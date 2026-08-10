import { createApp } from './app/app.js';
import { logger } from '@pkg/logger';
import { loadModelRuntimeFromEnvironment } from '@pkg/ml';
import { createRecommendationRanker } from '@pkg/recommender';

async function bootstrap(): Promise<void> {
  const modelRuntime = await loadModelRuntimeFromEnvironment();
  const app = createApp({
    mlStatus: modelRuntime.status,
    recommendationRanker: createRecommendationRanker({ modelScoreProvider: modelRuntime.modelScoreProvider }),
  });
  const port = Number(process.env.PORT ?? 3333);

  app.listen(port, () => {
    logger.info({
      component: 'bff',
      event: 'started',
      mlMode: modelRuntime.status.mode,
      mlStatus: modelRuntime.status.status,
      modelVersion: modelRuntime.status.modelVersion ?? null,
      port,
    });
  });
}

void bootstrap();
