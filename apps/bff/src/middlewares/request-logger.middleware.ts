import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '@pkg/logger';

export function createRequestLogger(): RequestHandler {
  return (request, response, next) => {
    const startedAt = Date.now();

    response.on('finish', () => {
      logger.info({ component: 'bff', durationMs: Date.now() - startedAt, event: 'request_completed', method: request.method, path: request.path, status: response.statusCode });
    });

    next();
  };
}

export function createAsyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

export const requestErrorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  logger.error({ component: 'bff', error: error instanceof Error ? error.name : 'UnknownError', event: 'request_failed', method: request.method, path: request.path });

  response.status(500).json({ error: 'Nao foi possivel concluir a requisicao.' });
};
