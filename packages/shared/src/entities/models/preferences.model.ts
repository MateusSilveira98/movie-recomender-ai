import type { RuntimePreference } from '../types/runtime-preference.type.js';

export interface Preferences {
  genres: string[];
  runtime: RuntimePreference;
  freeText: string;
}
