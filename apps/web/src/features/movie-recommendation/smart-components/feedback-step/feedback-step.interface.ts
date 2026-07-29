import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';

export interface FeedbackStepProps {
  history: ViewerHistory;
  watchedMovies: Movie[];
  onBack: () => void;
  onContinue: () => void;
  onOpinionChange: (movieId: string, opinion: 'liked' | 'disliked') => void;
}
