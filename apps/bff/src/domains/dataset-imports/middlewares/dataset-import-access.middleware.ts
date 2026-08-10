import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function createDatasetImportAccessMiddleware(adminToken: string | undefined): RequestHandler {
  const expected = adminToken?.trim();

  return (request, response, next) => {
    if (!expected) {
      response.status(503).json({ error: 'Importação de datasets não está configurada.' });
      return;
    }

    const candidate = request.get('x-dataset-import-token');

    if (!candidate || candidate.length !== expected.length || !timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) {
      response.status(403).json({ error: 'Acesso não autorizado para importação de datasets.' });
      return;
    }

    next();
  };
}
