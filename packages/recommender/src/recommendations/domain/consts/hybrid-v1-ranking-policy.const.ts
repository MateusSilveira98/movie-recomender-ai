import type { RecommendationRankingPolicy } from '../models/recommendation-ranking-policy.model.js';

export const HYBRID_V1_RANKING_POLICY: RecommendationRankingPolicy = {
  modelScoreReasonThreshold: 0.5,
  recommendationLimit: 4,
  version: 'hybrid-v1',
  weights: {
    dislikedGenreMatch: -1,
    likedGenreMatch: 1,
    modelScore: 2,
    preferenceGenreMatch: 2,
    runtimeMatch: 1,
    runtimeMismatch: -1,
  },
};
