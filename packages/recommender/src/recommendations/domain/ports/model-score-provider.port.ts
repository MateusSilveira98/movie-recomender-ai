import type { Movie } from '@pkg/shared/entities/models/movie.model';

export interface ModelScoreBatch {
  modelVersion?: string;
  scores: ReadonlyMap<string, number>;
}

export interface ModelScoreProvider {
  getScores(movies: readonly Movie[]): ModelScoreBatch;
}
