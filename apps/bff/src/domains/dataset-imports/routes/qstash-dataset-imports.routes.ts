import express from 'express';
import { parseDatasetImportCommand, type DatasetImportCommand, type QstashConfiguration } from '@pkg/recommender';
import { createAsyncHandler } from '../../../middlewares/request-logger.middleware.js';
import { createQstashSignatureMiddleware } from '../middlewares/qstash-signature.middleware.js';

export function createQstashDatasetImportRoutes(
  configuration: QstashConfiguration | null,
  processCommand: (command: DatasetImportCommand) => Promise<void> = unsupportedCommandProcessor,
): express.Router {
  const router = express.Router();

  router.post(
    '/internal/qstash/dataset-imports/commands',
    express.raw({ limit: '1mb', type: () => true }),
    createQstashSignatureMiddleware(configuration),
    createAsyncHandler(async (request, response) => {
      const command = parseDatasetImportCommand(request.body);
      if (!command) {
        response.status(400).json({ error: 'O comando de importacao e invalido.' });
        return;
      }

      try {
        await processCommand(command);
        response.status(204).end();
      } catch (error) {
        if (isNonRetryable(error)) {
          response.set('Upstash-NonRetryable-Error', 'true');
          response.status(400).json({ error: 'O comando de importacao nao pode ser processado.' });
          return;
        }

        throw error;
      }
    }),
  );

  return router;
}

async function unsupportedCommandProcessor(): Promise<void> {
  const error = new Error('O consumidor QStash do reader ainda nao foi ligado.') as Error & { nonRetryable?: boolean };
  error.nonRetryable = true;
  throw error;
}

function isNonRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'nonRetryable' in error && error.nonRetryable === true;
}
