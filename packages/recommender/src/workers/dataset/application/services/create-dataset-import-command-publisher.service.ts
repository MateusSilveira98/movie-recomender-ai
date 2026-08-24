import type { DatasetImportCommandPublisher } from '../ports/dataset-import-command-publisher.port.js';
import { getQstashConfiguration } from '../../infrastructure/config/qstash-configuration.service.js';
import { createQstashDatasetImportCommandPublisher } from '../../infrastructure/messaging/qstash-dataset-import-command.adapter.js';
import { createRabbitMqDatasetImportCommandPublisher } from '../../infrastructure/messaging/rabbitmq-dataset-import-command.adapter.js';

type Environment = Readonly<Record<string, string | undefined>>;

export function createDatasetImportCommandPublisher(environment: Environment = process.env): DatasetImportCommandPublisher {
  const qstash = getQstashConfiguration(environment);
  if (qstash) {
    return createQstashDatasetImportCommandPublisher(qstash);
  }

  const rabbitMqUrl = environment.RABBITMQ_URL?.trim();
  if (rabbitMqUrl) {
    return createRabbitMqDatasetImportCommandPublisher(rabbitMqUrl);
  }

  throw new Error('Configure QStash ou RABBITMQ_URL para importar datasets.');
}
