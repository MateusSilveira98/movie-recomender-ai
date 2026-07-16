import type { SessionFeedback } from '../types/session-feedback.type.js';

export interface SessionFeedbackRequest {
  movieId: string;
  feedback: SessionFeedback;
}
