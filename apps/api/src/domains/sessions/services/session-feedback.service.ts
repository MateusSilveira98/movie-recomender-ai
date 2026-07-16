import type { ViewerHistory } from '../../../../../../packages/shared/src/entities/models/viewer-history.model.js';
import type { SessionFeedback } from '../../../../../../packages/shared/src/entities/types/session-feedback.type.js';

export function applyFeedbackToHistory(
  history: ViewerHistory,
  movieId: string,
  feedback: SessionFeedback,
): ViewerHistory {
  return {
    watched: ensureIncluded(history.watched, movieId),
    liked: feedback === 'liked' ? ensureIncluded(history.liked, movieId) : removeMovie(history.liked, movieId),
    disliked:
      feedback === 'disliked' ? ensureIncluded(history.disliked, movieId) : removeMovie(history.disliked, movieId),
  };
}

function ensureIncluded(movieIds: string[], movieId: string): string[] {
  return movieIds.includes(movieId) ? movieIds : [...movieIds, movieId];
}

function removeMovie(movieIds: string[], movieId: string): string[] {
  return movieIds.filter((currentMovieId) => currentMovieId !== movieId);
}
