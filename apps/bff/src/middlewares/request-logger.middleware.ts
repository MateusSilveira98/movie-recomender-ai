import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '@pkg/logger';
import { finishServerSpan, recordHttpRequest, startServerSpan } from '@pkg/observability';
import multer from 'multer';

export function createRequestLogger(): RequestHandler {
  return (request, response, next) => {
    const startedAt = Date.now();
    const span = startServerSpan(request.method, request.path === '/health' ? '/health' : request.path);

    response.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const route = resolveRequestRoute(request);
      span.updateName(`HTTP ${request.method} ${route}`);
      span.setAttribute('http.route', route);
      recordHttpRequest({
        durationMs,
        method: request.method,
        route,
        status: response.statusCode,
      });
      finishServerSpan(span, response.statusCode);
      logger.info({
        component: 'bff',
        durationMs,
        event: 'request_completed',
        method: request.method,
        path: request.path,
        status: response.statusCode,
      });
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
  logger.error({
    component: 'bff',
    error: error instanceof Error ? error.name : 'UnknownError',
    event: 'request_failed',
    method: request.method,
    path: request.path,
  });

  if (error instanceof multer.MulterError) {
    response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Upload CSV invalido.' });
    return;
  }

  response.status(500).json({ error: 'Nao foi possivel concluir a requisicao.' });
};

function resolveRequestRoute(request: Request): string {
  if (request.route?.path) {
    return `${request.baseUrl}${request.route.path}`;
  }

  return request.path === '/health' ? '/health' : 'unmatched';
}
