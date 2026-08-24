import type { DatasetImportCommand } from '../../domain/dataset-import-command.types.js';

export interface DatasetImportCommandPublisher {
  publish(command: DatasetImportCommand): Promise<void>;
}
