import cors from 'cors';
import express from 'express';
import { createDatabaseClient, getDatabaseHealth } from '@pkg/database';
import { getTrainingPipelineStatus } from '@pkg/ml';
import { getDemoRecommendations } from '@pkg/recommender';
import { createSessionProfile } from '@pkg/shared/data-access/factories/session-profile.factory';
import { getHealthMessage } from '@pkg/shared/data-access/services/api-services/health';
import { createSqlSessionRepository } from '../domains/sessions/repositories/sessions.repository.js';
import { createRequestLogger, requestErrorHandler } from '../middlewares/request-logger.middleware.js';
import { createAppRouter } from './routes.js';

const LOCAL_WEB_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function createApp(): express.Express {
  const app = express();
  const databaseClient = createDatabaseClient();
  const sessionRepository = createSqlSessionRepository(databaseClient);

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
  app.use(createRequestLogger());

  app.get('/health', async (_request, response) => {
    response.json({
      status: 'ok',
      message: getHealthMessage('bff'),
      database: await getDatabaseHealth(),
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
  app.use(requestErrorHandler);

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
