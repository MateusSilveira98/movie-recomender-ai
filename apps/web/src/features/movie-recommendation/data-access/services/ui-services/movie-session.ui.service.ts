import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';

export interface RecommendationRound {
  id: string;
  createdAt: string;
  preferences: Preferences;
  history: ViewerHistory;
  recommendations: Recommendation[];
}
