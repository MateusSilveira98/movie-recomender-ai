import type { Preferences } from './preferences.model.js';
import type { ViewerHistory } from './viewer-history.model.js';

export interface Session {
  id: string;
  preferences: Preferences;
  history: ViewerHistory;
  createdAt: string;
}
