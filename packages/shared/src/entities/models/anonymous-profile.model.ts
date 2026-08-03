import type { Preferences } from './preferences.model.js';
import type { ViewerHistory } from './viewer-history.model.js';

export interface AnonymousProfile {
  preferences: Preferences;
  history: ViewerHistory;
}
