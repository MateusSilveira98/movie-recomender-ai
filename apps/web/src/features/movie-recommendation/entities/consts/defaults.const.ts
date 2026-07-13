import type { Preferences } from '@movie-recomender-ai/shared/entities/models/preferences.model';
import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';

export const DEFAULT_PREFERENCES: Preferences = {
  genres: ['Ficcao cientifica', 'Suspense'],
  moods: ['intenso'],
  runtime: 'medium',
  freeText: '',
};

export const DEFAULT_HISTORY: ViewerHistory = {
  watched: [],
  liked: [],
  disliked: [],
};
