import cors from 'cors';
import express from 'express';
import { getDatabaseHealth } from '../../../../packages/database/src/index.js';
import { getTrainingPipelineStatus } from '../../../../packages/ml/src/index.js';
import { getDemoRecommendations } from '../../../../packages/recommender/src/index.js';
import { createSessionProfile } from '../../../../packages/shared/src/data-access/factories/session-profile.factory.js';
import { getHealthMessage } from '../../../../packages/shared/src/data-access/services/api-services/health/index.js';
import { createInMemorySessionRepository } from '../domains/sessions/repositories/sessions.repository.js';
import { createAppRouter } from './routes.js';

const LOCAL_WEB_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function createApp(): express.Express {
  const app = express();
  const sessionRepository = createInMemorySessionRepository();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || isAllowedWebOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`CORS bloqueado para a origem ${origin}.`));
      },
    }),
  );
  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      message: getHealthMessage('api'),
      database: getDatabaseHealth(),
      ml: getTrainingPipelineStatus(),
    });
  });

  app.get('/recommendations/demo', (_request, response) => {
    const profile = createSessionProfile({
      genres: ['Ficcao cientifica', 'Suspense'],
      likedMovies: ['Matrix'],
      dislikedMovies: ['Interestelar'],
    });

    response.json({
      profile,
      recommendations: getDemoRecommendations(profile),
    });
  });

  app.use(createAppRouter({ sessionRepository }));

  return app;
}

function isAllowedWebOrigin(origin: string): boolean {
  const configuredOrigins = (process.env.WEB_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (configuredOrigins.includes(origin)) {
    return true;
  }

  return LOCAL_WEB_ORIGIN_PATTERN.test(origin);
}
