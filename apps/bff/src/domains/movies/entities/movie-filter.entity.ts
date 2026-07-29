import type { RuntimePreference } from '@pkg/shared/entities/types/runtime-preference.type';

export interface MovieFilter {
  genres: string[];
  runtime: RuntimePreference;
  limit: number;
}
