import { connect, type Channel } from 'amqplib';
import type { DatasetImportChunkDispatcher, DatasetImportChunkMessage } from '../../application/ports/dataset-import-chunk-dispatcher.port.js';
import { DATASET_FILE_TYPES, type DatasetFileType } from '../../domain/dataset-import-queue.types.js';

const EXCHANGE_NAME = 'dataset-import';
export const DATASET_IMPORT_RATINGS_QUEUE = queueName('ratings');

export function createRabbitMqDatasetImportChunkDispatcher(amqpUrl: string): DatasetImportChunkDispatcher {
  return {
    async publish(message) {
      await this.publishMany!([message]);
    },
    async publishMany(messages) {
      for (const message of messages) assertMessage(message);
      if (messages.length === 0) return;
      const connection = await connect(amqpUrl);

      try {
        const channel = await connection.createConfirmChannel();
        await configureDatasetImportTopology(channel);
        for (const message of messages) {
          channel.publish(EXCHANGE_NAME, routingKey(message.type), Buffer.from(JSON.stringify(message)), {
            contentType: 'application/json',
            deliveryMode: 2,
            messageId: message.chunkId,
          });
        }
        await channel.waitForConfirms();
        await channel.close();
      } finally {
        await connection.close();
      }
    },
  };
}

export async function configureDatasetImportTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });

  for (const type of DATASET_FILE_TYPES) {
    await channel.assertQueue(dlqName(type), { durable: true });
    await channel.assertQueue(retryQueueName(type), {
      arguments: {
        'x-dead-letter-exchange': EXCHANGE_NAME,
        'x-dead-letter-routing-key': routingKey(type),
        'x-message-ttl': 30_000,
      },
      durable: true,
    });
    await channel.assertQueue(queueName(type), {
      arguments: {
        'x-dead-letter-exchange': EXCHANGE_NAME,
        'x-dead-letter-routing-key': dlqRoutingKey(type),
      },
      durable: true,
    });
    await channel.bindQueue(queueName(type), EXCHANGE_NAME, routingKey(type));
    await channel.bindQueue(retryQueueName(type), EXCHANGE_NAME, retryRoutingKey(type));
    await channel.bindQueue(dlqName(type), EXCHANGE_NAME, dlqRoutingKey(type));
  }
}

export function queueName(type: DatasetFileType): string {
  return `dataset-import.${type}`;
}

export function retryQueueName(type: DatasetFileType): string {
  return `${queueName(type)}.retry`;
}

export function routingKey(type: DatasetFileType): string {
  return `${type}.chunk`;
}

export function retryRoutingKey(type: DatasetFileType): string {
  return `${routingKey(type)}.retry`;
}

function dlqName(type: DatasetFileType): string {
  return `${queueName(type)}.dlq`;
}

function dlqRoutingKey(type: DatasetFileType): string {
  return `${routingKey(type)}.dlq`;
}

function assertMessage(message: DatasetImportChunkMessage): void {
  if (!message.chunkId || !message.jobId || !DATASET_FILE_TYPES.includes(message.type)) {
    throw new Error('A mensagem do chunk precisa conter jobId, chunkId e type válidos.');
  }
}
