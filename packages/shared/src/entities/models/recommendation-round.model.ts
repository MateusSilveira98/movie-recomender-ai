import type { Preferences } from './preferences.model.js';
import type { Recommendation } from './recommendation.model.js';
import type { ViewerHistory } from './viewer-history.model.js';

export interface RecommendationRound {
  createdAt: string;
  history: ViewerHistory;
  preferences: Preferences;
  recommendations: Recommendation[];
}
