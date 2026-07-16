import type { RuntimePreference } from '../../../../../../packages/shared/src/entities/types/runtime-preference.type.js';

export interface MovieFilter {
  genres: string[];
  runtime: RuntimePreference;
  limit: number;
}
