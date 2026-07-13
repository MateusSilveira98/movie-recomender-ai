import type { Preferences } from '@movie-recomender-ai/shared/entities/models/preferences.model';
import type { Recommendation } from '@movie-recomender-ai/shared/entities/models/recommendation.model';
import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';

export interface RecommendationRound {
  id: string;
  createdAt: string;
  preferences: Preferences;
  history: ViewerHistory;
  recommendations: Recommendation[];
}

export interface StoredSession {
  preferences: Preferences;
  history: ViewerHistory;
  rounds: RecommendationRound[];
}
