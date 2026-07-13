import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';

export interface WatchedStepProps {
  history: ViewerHistory;
  onBack: () => void;
  onContinue: () => void;
  onWatchedToggle: (movieId: string) => void;
}
