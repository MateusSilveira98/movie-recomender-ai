import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TrainedModelMetadata, TrainedModelPublisher } from '../../application/ports/trained-model.publisher.port.js';
import type { TrainingModel } from '../../application/ports/training-model.port.js';

export function createFileSystemTrainedModelPublisher(directory: string): TrainedModelPublisher {
  return { publish: (model, metadata) => publishModel(model, metadata, directory) };
}

async function publishModel(model: TrainingModel, metadata: TrainedModelMetadata, directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  await model.export(directory);
  await writeFile(resolve(directory, 'training-metadata.json'), JSON.stringify(metadata, null, 2));
  return directory;
}
