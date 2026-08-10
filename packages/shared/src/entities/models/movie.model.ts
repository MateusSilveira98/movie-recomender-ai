import type { MovieModelFeatures } from './movie-model-features.model.js';

export interface Movie {
  id: string;
  title: string;
  year: number;
  genres: string[];
  runtime: number;
  adult: boolean;
  popularity: number;
  modelFeatures?: MovieModelFeatures;
  voteCount: number;
  description: string;
}
