import type { Movie } from '@movie-recomender-ai/shared/entities/models/movie.model';
import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';

export interface FeedbackStepProps {
  history: ViewerHistory;
  watchedMovies: Movie[];
  onBack: () => void;
  onContinue: () => void;
  onOpinionChange: (movieId: string, opinion: 'liked' | 'disliked') => void;
}
