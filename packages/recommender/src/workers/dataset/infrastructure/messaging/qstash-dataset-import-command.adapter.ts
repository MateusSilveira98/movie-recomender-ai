import type { DatasetImportCommandPublisher } from '../../application/ports/dataset-import-command-publisher.port.js';
import { assertDatasetImportCommand } from '../../domain/dataset-import-command.parser.js';
import { qstashDatasetImportCommandUrl, type QstashConfiguration } from '../config/qstash-configuration.service.js';
import { createQstashPublisher, type QstashPublisher } from './qstash-client.js';

export function createQstashDatasetImportCommandPublisher(
  configuration: QstashConfiguration,
  publisher: QstashPublisher = createQstashPublisher(configuration),
): DatasetImportCommandPublisher {
  const destination = qstashDatasetImportCommandUrl(configuration);

  return {
    async publish(command) {
      assertDatasetImportCommand(command);
      await publisher.publishJson(destination, command);
    },
  };
}
