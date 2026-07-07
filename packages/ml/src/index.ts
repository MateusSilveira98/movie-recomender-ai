export interface TrainingPipelineStatus {
  framework: 'tensorflow-js';
  mode: 'offline';
  status: 'not-trained-yet';
}

export function getTrainingPipelineStatus(): TrainingPipelineStatus {
  return {
    framework: 'tensorflow-js',
    mode: 'offline',
    status: 'not-trained-yet',
  };
}
