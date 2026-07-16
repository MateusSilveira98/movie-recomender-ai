import type { Movie } from '@movie-recomender-ai/shared/entities/models/movie.model';
import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';
import type { RequestStatus } from '../../entities/types/request-status.type';

export interface WatchedStepProps {
  history: ViewerHistory;
  movies: Movie[];
  moviesStatus: RequestStatus;
  onBack: () => void;
  onContinue: () => void;
  onRetryMovies: () => void;
  onWatchedToggle: (movieId: string) => void;
}
