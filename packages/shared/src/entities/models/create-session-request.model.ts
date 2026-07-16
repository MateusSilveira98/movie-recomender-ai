import type { Preferences } from './preferences.model.js';
import type { ViewerHistory } from './viewer-history.model.js';

export interface CreateSessionRequest {
  preferences: Preferences;
  history?: ViewerHistory;
}
