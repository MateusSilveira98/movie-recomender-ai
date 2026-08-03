import type { SessionFeedback } from '../types/session-feedback.type.js';

export interface SessionFeedbackRequest {
  impressionId: string;
  feedback: SessionFeedback;
}
