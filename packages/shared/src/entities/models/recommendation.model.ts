import type { Movie } from './movie.model.js';

export interface Recommendation extends Movie {
  score: number;
  reason: string;
}
