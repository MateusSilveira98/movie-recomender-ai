import { connect } from 'amqplib';
import { DATASET_FILE_TYPES } from '../../domain/dataset-import-queue.types.js';
import type { DatasetImportCommand, NormalizedDatasetImportCommand } from '../../domain/dataset-import-command.types.js';

const COMMAND_QUEUE = 'dataset-import.commands';
const NORMALIZED_COMMAND_QUEUE = 'dataset-import.normalized-commands';

export interface NormalizedDatasetImportCommandPublisher {
  publish(command: NormalizedDatasetImportCommand): Promise<void>;
  publishMany(commands: readonly NormalizedDatasetImportCommand[]): Promise<void>;
}

export function createRabbitMqDatasetImportCommandPublisher(amqpUrl: string) {
  return {
    async publish(command: DatasetImportCommand): Promise<void> {
      assertCommand(command);
      const connection = await connect(amqpUrl);

      try {
        const channel = await connection.createConfirmChannel();
        await channel.assertQueue(COMMAND_QUEUE, { durable: true });
        channel.sendToQueue(COMMAND_QUEUE, Buffer.from(JSON.stringify(command)), {
          contentType: 'application/json',
          deliveryMode: 2,
          messageId: command.uploadId,
        });
        await channel.waitForConfirms();
        await channel.close();
      } finally {
        await connection.close();
      }
    },
  };
}

export function createRabbitMqNormalizedDatasetImportCommandPublisher(amqpUrl: string): NormalizedDatasetImportCommandPublisher {
  return {
    async publish(command: NormalizedDatasetImportCommand): Promise<void> {
      await this.publishMany([command]);
    },
    async publishMany(commands: readonly NormalizedDatasetImportCommand[]): Promise<void> {
      for (const command of commands) assertNormalizedCommand(command);
      await publishMany(amqpUrl, NORMALIZED_COMMAND_QUEUE, commands, (command) => `${command.uploadId}:${command.completed ? 'completed' : command.chunks[0]?.sequence}`);
    },
  };
}

export async function consumeRabbitMqDatasetImportCommands(
  amqpUrl: string,
  handler: { process(command: DatasetImportCommand): Promise<void> },
): Promise<void> {
  const connection = await connect(amqpUrl);
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue(COMMAND_QUEUE, { durable: true });
  await channel.prefetch(1);

  await channel.consume(COMMAND_QUEUE, (delivery) => {
    if (!delivery) return;
    void handleDelivery(delivery);
  }, { noAck: false });

  async function handleDelivery(delivery: NonNullable<Parameters<Parameters<typeof channel.consume>[1]>[0]>): Promise<void> {
    const command = parseCommand(delivery.content);
    if (!command) {
      channel.nack(delivery, false, false);
      return;
    }

    try {
      await handler.process(command);
      channel.ack(delivery);
    } catch (error) {
      channel.nack(delivery, false, !isNonRetryable(error));
    }
  }
}

export async function consumeRabbitMqNormalizedDatasetImportCommands(
  amqpUrl: string,
  handler: { process(command: NormalizedDatasetImportCommand): Promise<void> },
): Promise<void> {
  await consume(amqpUrl, NORMALIZED_COMMAND_QUEUE, parseNormalizedCommand, handler);
}

async function publishMany<T>(amqpUrl: string, queue: string, values: readonly T[], messageId: (value: T) => string): Promise<void> {
  if (values.length === 0) return;
  const connection = await connect(amqpUrl);
  try {
    const channel = await connection.createConfirmChannel();
    await channel.assertQueue(queue, { durable: true });
    for (const value of values) {
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(value)), { contentType: 'application/json', deliveryMode: 2, messageId: messageId(value) });
    }
    await channel.waitForConfirms();
    await channel.close();
  } finally { await connection.close(); }
}

async function consume<T>(amqpUrl: string, queue: string, parse: (content: Buffer) => T | null, handler: { process(command: T): Promise<void> }): Promise<void> {
  const connection = await connect(amqpUrl);
  const channel = await connection.createConfirmChannel();
  connection.on('error', () => undefined);
  channel.on('error', () => undefined);
  await channel.assertQueue(queue, { durable: true });
  await channel.prefetch(1);
  await channel.consume(queue, (delivery) => {
    if (!delivery) return;
    const command = parse(delivery.content);
    if (!command) { channel.nack(delivery, false, false); return; }
    void handler.process(command).then(() => channel.ack(delivery), () => channel.nack(delivery, false, true));
  }, { noAck: false });

  await waitForConnectionClose(connection);
}

function waitForConnectionClose(connection: { once(event: 'close', listener: () => void): unknown }): Promise<never> {
  return new Promise((_, reject) => {
    connection.once('close', () => reject(new Error('A conexão RabbitMQ do consumidor foi encerrada.')));
  });
}

function parseCommand(content: Buffer): DatasetImportCommand | null {
  try {
    const value: unknown = JSON.parse(content.toString('utf8'));
    if (typeof value !== 'object' || value === null) return null;
    const command = value as DatasetImportCommand;
    return typeof command.uploadId === 'string' && command.uploadId.length > 0
      && typeof command.objectKey === 'string' && command.objectKey.length > 0
      && typeof command.fileName === 'string' && command.fileName.length > 0
      && typeof command.sizeBytes === 'number' && Number.isSafeInteger(command.sizeBytes) && command.sizeBytes >= 0
      && typeof command.type === 'string' && DATASET_FILE_TYPES.includes(command.type)
      ? command
      : null;
  } catch {
    return null;
  }
}

function assertCommand(command: DatasetImportCommand): void {
  if (!command.uploadId || !command.objectKey || !command.fileName || !Number.isSafeInteger(command.sizeBytes) || command.sizeBytes < 0 || !DATASET_FILE_TYPES.includes(command.type)) {
    throw new Error('O comando de importação precisa conter metadados válidos.');
  }
}

function parseNormalizedCommand(content: Buffer): NormalizedDatasetImportCommand | null {
  try {
    const value: unknown = JSON.parse(content.toString('utf8'));
    if (typeof value !== 'object' || value === null) return null;
    const command = value as NormalizedDatasetImportCommand;
    const completed = command.completed === true;
    return typeof command.uploadId === 'string' && command.uploadId.length > 0
      && typeof command.fileName === 'string' && command.fileName.length > 0
      && typeof command.sizeBytes === 'number' && Number.isSafeInteger(command.sizeBytes) && command.sizeBytes >= 0
      && typeof command.type === 'string' && DATASET_FILE_TYPES.includes(command.type)
      && Array.isArray(command.chunks) && (completed || command.chunks.length > 0)
    && command.chunks.every((chunk) => typeof chunk.payloadPath === 'string' && chunk.payloadPath.length > 0 && typeof chunk.contentHash === 'string' && Number.isInteger(chunk.sequence))
      ? { ...command, completed, normalizedChunkCount: Number.isInteger(command.normalizedChunkCount) ? command.normalizedChunkCount : command.chunks.length } : null;
  } catch { return null; }
}

function isNonRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'nonRetryable' in error && error.nonRetryable === true;
}

function assertNormalizedCommand(command: NormalizedDatasetImportCommand): void {
  if (!command.uploadId || !command.fileName || !Number.isSafeInteger(command.sizeBytes) || !DATASET_FILE_TYPES.includes(command.type) || (!command.completed && command.chunks.length === 0) || !Number.isInteger(command.normalizedChunkCount) || command.normalizedChunkCount < 0) {
    throw new Error('O comando normalizado de importação é inválido.');
  }
}
