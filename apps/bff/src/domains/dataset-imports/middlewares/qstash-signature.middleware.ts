import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyQstashSignature, type QstashConfiguration } from '@pkg/recommender';

export function createQstashSignatureMiddleware(configuration: QstashConfiguration | null): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!configuration) {
      response.status(503).json({ error: 'QStash nao configurado.' });
      return;
    }

    const signature = request.get('upstash-signature') ?? '';
    const body = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';

    if (!verifyQstashSignature(configuration, { body, signature })) {
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
