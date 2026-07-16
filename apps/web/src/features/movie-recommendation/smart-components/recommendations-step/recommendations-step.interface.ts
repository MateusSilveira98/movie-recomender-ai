import type { Recommendation } from '@movie-recomender-ai/shared/entities/models/recommendation.model';
import type { RequestStatus } from '../../entities/types/request-status.type';
import type { RecommendationRound } from '../../data-access/services/ui-services/movie-session.ui.service';

export interface RecommendationsStepProps {
  recommendations: Recommendation[];
  recommendationsStatus: RequestStatus;
  recommendationsError: string | null;
  rounds: RecommendationRound[];
  onFeedback: (movieId: string, opinion: 'liked' | 'disliked') => void;
  onStartNewRound: () => void;
}
