import type { RequestStatus } from '../../entities/types/request-status.type';
import type { SessionRecommendation } from '../../entities/models/session-recommendation.model';
import type { RecommendationRound } from '../../data-access/services/ui-services/movie-session.ui.service';

export interface RecommendationsStepProps {
  recommendations: SessionRecommendation[];
  recommendationsStatus: RequestStatus;
  recommendationsError: string | null;
  rounds: RecommendationRound[];
  onFeedback: (impressionId: string, opinion: 'liked' | 'disliked') => void;
  onStartNewRound: () => void;
}
