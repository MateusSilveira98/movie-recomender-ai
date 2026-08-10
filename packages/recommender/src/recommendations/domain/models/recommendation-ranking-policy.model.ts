export interface RecommendationRankingPolicy {
  modelScoreReasonThreshold: number;
  recommendationLimit: number;
  version: string;
  weights: {
    dislikedGenreMatch: number;
    likedGenreMatch: number;
    modelScore: number;
    preferenceGenreMatch: number;
    runtimeMatch: number;
    runtimeMismatch: number;
  };
}
