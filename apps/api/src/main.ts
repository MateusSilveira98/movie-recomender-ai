import express from 'express';
import { getDatabaseHealth } from '../../../packages/database/src/index.js';
import { getTrainingPipelineStatus } from '../../../packages/ml/src/index.js';
import { getDemoRecommendations } from '../../../packages/recommender/src/index.js';
import { createSessionProfile, getHealthMessage } from '../../../packages/shared/src/index.js';

const app = express();
const port = Number(process.env.PORT ?? 3333);

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

app.listen(port, () => {
  console.log(`Movie Recommender API running at http://localhost:${port}`);
});
