import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';

export interface RecommendationRanking {
  candidateCount: number;
  modelVersion?: string;
  rankingVersion: string;
  recommendations: Recommendation[];
}
