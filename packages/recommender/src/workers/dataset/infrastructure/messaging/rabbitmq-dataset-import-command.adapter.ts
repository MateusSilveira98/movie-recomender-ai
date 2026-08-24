import { connect } from 'amqplib';
import {
  assertDatasetImportCommand,
  assertNormalizedDatasetImportCommand,
  parseDatasetImportCommand,
  parseNormalizedDatasetImportCommand,
} from '../../domain/dataset-import-command.parser.js';
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
      assertDatasetImportCommand(command);
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
      for (const command of commands) assertNormalizedDatasetImportCommand(command);
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
    const command = parseCommandBuffer(delivery.content);
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
  await consume(amqpUrl, NORMALIZED_COMMAND_QUEUE, parseNormalizedCommandBuffer, handler);
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

function parseCommandBuffer(content: Buffer): DatasetImportCommand | null {
  try {
    return parseDatasetImportCommand(JSON.parse(content.toString('utf8')));
  } catch {
    return null;
  }
}

function parseNormalizedCommandBuffer(content: Buffer): NormalizedDatasetImportCommand | null {
  try {
    return parseNormalizedDatasetImportCommand(JSON.parse(content.toString('utf8')));
  } catch {
    return null;
  }
}

function isNonRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'nonRetryable' in error && error.nonRetryable === true;
}
