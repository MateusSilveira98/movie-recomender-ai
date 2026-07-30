import type { MovieTrainingRecord } from '../../domain/models/movie-training-record.model.js';

export interface TrainingRecordRepository {
  list(): Promise<MovieTrainingRecord[]>;
}
