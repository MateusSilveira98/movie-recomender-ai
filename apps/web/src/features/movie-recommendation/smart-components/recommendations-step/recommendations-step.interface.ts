import type { Recommendation } from '@movie-recomender-ai/shared/entities/models/recommendation.model';
import type { RecommendationRound } from '../../data-access/services/ui-services/movie-session.ui.service';

export interface RecommendationsStepProps {
  recommendations: Recommendation[];
  rounds: RecommendationRound[];
  onStartNewRound: () => void;
}
