import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { qstashDatasetImportCommandUrl, verifyQstashSignature, type QstashConfiguration } from '@pkg/recommender';

export function createQstashSignatureMiddleware(configuration: QstashConfiguration | null): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (!configuration) {
      response.status(503).json({ error: 'QStash nao configurado.' });
      return;
    }

    const signature = request.get('upstash-signature') ?? '';
    const body = readRawRequestBody(request);
    const destination = qstashDatasetImportCommandUrl(configuration);

    if (!(await verifyQstashSignature(configuration, {
      body,
      signature,
      url: destination,
    }))) {
      response.status(401).json({ error: 'Assinatura QStash invalida.' });
      return;
    }

    try {
      request.body = body.length > 0 ? JSON.parse(body) : {};
    } catch {
      response.status(400).json({ error: 'O payload QStash precisa ser um JSON valido.' });
      return;
    }

    next();
  };
}

function readRawRequestBody(request: Request): string {
  if (Buffer.isBuffer(request.body)) {
    return request.body.toString('utf8');
  }

  if (typeof request.body === 'string') {
    return request.body;
  }

  return '';
}
