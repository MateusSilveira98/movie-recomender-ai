import type { Mood } from '../types/mood.type.js';
import type { RuntimePreference } from '../types/runtime-preference.type.js';

export interface Preferences {
  genres: string[];
  moods: Mood[];
  runtime: RuntimePreference;
  freeText: string;
}
