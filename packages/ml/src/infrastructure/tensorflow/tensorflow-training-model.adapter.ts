import * as tf from '@tensorflow/tfjs-node';
import type { TrainingModel, TrainingModelPort } from '../../application/ports/training-model.port.js';
import type { PreparedTrainingData } from '../../domain/models/prepared-training-data.model.js';

export function createTensorflowTrainingModel(): TrainingModelPort {
  return { create, predict, train };
}

function create(featureCount: number): TensorflowModel {
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [featureCount], activation: 'relu', units: 8 }));
  model.add(tf.layers.dense({ activation: 'sigmoid', units: 1 }));
  model.compile({ loss: 'meanSquaredError', optimizer: tf.train.adam(0.01) });
  return { dispose: () => model.dispose(), export: async (directory) => { await model.save(`file://${directory}`); }, model };
}

async function train(model: TrainingModel, trainData: PreparedTrainingData, validationData: PreparedTrainingData): Promise<void> {
  const tensorflowModel = asTensorflowModel(model);
  const tensors = createTrainingTensors(trainData, validationData);

  try {
    await tensorflowModel.model.fit(tensors.trainFeatures, tensors.trainLabels, {
      batchSize: Math.min(16, trainData.features.length),
      epochs: 40,
      shuffle: false,
      validationData: [tensors.validationFeatures, tensors.validationLabels],
      verbose: 0,
    });
  } finally {
    disposeTensors(tensors);
  }
}

function predict(model: TrainingModel, features: number[][]): number[] {
  const input = tf.tensor2d(features);

  try {
    const prediction = asTensorflowModel(model).model.predict(input) as tf.Tensor;

    try {
      return Array.from(prediction.dataSync());
    } finally {
      prediction.dispose();
    }
  } finally {
    input.dispose();
  }
}

function asTensorflowModel(model: TrainingModel): TensorflowModel {
  if (!('model' in model)) {
    throw new Error('O modelo de treino não é compatível com TensorFlow.');
  }

  return model as TensorflowModel;
}

function createTrainingTensors(trainData: PreparedTrainingData, validationData: PreparedTrainingData): TrainingTensors {
  return {
    trainFeatures: tf.tensor2d(trainData.features),
    trainLabels: tf.tensor2d(trainData.labels, [trainData.labels.length, 1]),
    validationFeatures: tf.tensor2d(validationData.features),
    validationLabels: tf.tensor2d(validationData.labels, [validationData.labels.length, 1]),
  };
}

function disposeTensors(tensors: TrainingTensors): void {
  tensors.trainFeatures.dispose();
  tensors.trainLabels.dispose();
  tensors.validationFeatures.dispose();
  tensors.validationLabels.dispose();
}

export interface TensorflowModel extends TrainingModel {
  model: tf.Sequential;
}

interface TrainingTensors {
  trainFeatures: tf.Tensor2D;
  trainLabels: tf.Tensor2D;
  validationFeatures: tf.Tensor2D;
  validationLabels: tf.Tensor2D;
}
