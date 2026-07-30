export interface TrainingDataSplit<T> {
  train: T[];
  validation: T[];
}

export function splitTrainingData<T>(records: readonly T[], validationRatio = 0.25): TrainingDataSplit<T> {
  const validationStart = records.length - validationSize(records.length, validationRatio);

  return {
    train: records.slice(0, validationStart),
    validation: records.slice(validationStart),
  };
}

function validationSize(recordCount: number, validationRatio: number): number {
  return Math.max(1, Math.floor(recordCount * validationRatio));
}
