import type { PreparedTrainingData } from '../../domain/models/prepared-training-data.model.js';

export interface TrainingModel {
  dispose(): void;
  export(directory: string): Promise<void>;
}

export interface TrainingModelPort {
  create(featureCount: number): TrainingModel;
  predict(model: TrainingModel, features: number[][]): number[];
  train(model: TrainingModel, train: PreparedTrainingData, validation: PreparedTrainingData): Promise<void>;
}
