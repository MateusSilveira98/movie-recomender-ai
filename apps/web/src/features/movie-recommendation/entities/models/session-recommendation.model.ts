import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';

export interface SessionRecommendation extends Recommendation {
  impressionId: string;
}
