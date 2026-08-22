import { recordImportChunk, recordQueueConsume } from '@pkg/observability';
import { connect } from 'amqplib';
import type { DatasetImportChunkMessage } from '../../application/ports/dataset-import-chunk-dispatcher.port.js';
import { immediateDatasetImportWriteExecutor, type DatasetImportWriteExecutor } from '../../application/dataset-import-write-executor.service.js';
import { DATASET_FILE_TYPES } from '../../domain/dataset-import-queue.types.js';
import {
  configureDatasetImportTopology,
  queueName,
  retryRoutingKey,
} from './rabbitmq-dataset-import-chunk-dispatcher.adapter.js';

const EXCHANGE_NAME = 'dataset-import';

export interface DatasetImportChunkMessageHandler {
  fail(message: DatasetImportChunkMessage): Promise<void>;
  process(message: DatasetImportChunkMessage): Promise<void>;
}

export async function consumeRabbitMqDatasetImportChunks(
  amqpUrl: string,
  type: import('../../domain/dataset-import-queue.types.js').DatasetFileType,
  handler: DatasetImportChunkMessageHandler,
  maximumAttempts: number = 3,
  writeExecutor: DatasetImportWriteExecutor = immediateDatasetImportWriteExecutor,
): Promise<void> {
  const connection = await connect(amqpUrl);
  const channel = await connection.createConfirmChannel();
  connection.on('error', () => undefined);
  channel.on('error', () => undefined);
  await configureDatasetImportTopology(channel);
  await channel.prefetch(1);

  await channel.consume(queueName(type), (delivery) => {
    if (!delivery) return;
    void handleDelivery(delivery);

    async function handleDelivery(received: NonNullable<typeof delivery>): Promise<void> {
      const message = parseMessage(received.content);

      if (!message) {
        channel.nack(received, false, false);
        recordQueueConsume('nack', type);
        return;
      }

      if (message.type !== type) {
        channel.nack(received, false, false);
        recordQueueConsume('nack', type);
        return;
      }

      try {
        await writeExecutor.execute(() => handler.process(message));
        channel.ack(received);
        recordQueueConsume('ack', type);
        recordImportChunk('processed', type);
      } catch {
        const attempts = Number(received.properties.headers?.['x-retry-count'] ?? 0) + 1;

        if (attempts >= maximumAttempts) {
          try {
            await writeExecutor.execute(() => handler.fail(message));
          } finally {
            channel.nack(received, false, false);
            recordQueueConsume('nack', type);
            recordImportChunk('failed', type);
          }
          return;
        }

        try {
          channel.publish(EXCHANGE_NAME, retryRoutingKey(message.type), received.content, {
            contentType: 'application/json',
            deliveryMode: 2,
            headers: { 'x-retry-count': attempts },
            messageId: message.chunkId,
          });
          await channel.waitForConfirms();
          channel.ack(received);
          recordQueueConsume('retry', type);
        } catch {
          channel.nack(received, false, true);
          recordQueueConsume('nack', type);
        }
      }
    }
  }, { noAck: false });

  await waitForConnectionClose(connection);
}

function waitForConnectionClose(connection: { once(event: 'close', listener: () => void): unknown }): Promise<never> {
  return new Promise((_, reject) => {
    connection.once('close', () => reject(new Error('A conexão RabbitMQ do consumidor foi encerrada.')));
  });
}

function parseMessage(content: Buffer): DatasetImportChunkMessage | null {
  try {
    const value: unknown = JSON.parse(content.toString('utf8'));

    if (typeof value !== 'object' || value === null) return null;
    const message = value as DatasetImportChunkMessage;
    return typeof message.chunkId === 'string' && message.chunkId && typeof message.jobId === 'string' && message.jobId
      && typeof message.type === 'string' && DATASET_FILE_TYPES.includes(message.type)
      ? message
      : null;
  } catch {
    return null;
  }
}
