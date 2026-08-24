import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface QstashSignatureKeys {
  currentSigningKey: string;
  nextSigningKey: string;
}

export interface QstashSignatureInput {
  body: string;
  clockToleranceSeconds?: number;
  signature: string;
  url?: string;
}

export function verifyQstashSignature(keys: QstashSignatureKeys, input: QstashSignatureInput): boolean {
  const signature = input.signature.trim();
  if (!signature) return false;

  return [keys.currentSigningKey, keys.nextSigningKey].some((key) => verifyWithKey(key, input, signature));
}

export function createQstashSignature(signingKey: string, body: string, url?: string, issuedAt = Math.floor(Date.now() / 1000)): string {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeSegment({
    body: hashBody(body),
    exp: issuedAt + 300,
    iat: issuedAt,
    iss: 'Upstash',
    nbf: issuedAt,
    sub: url ?? '',
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned, signingKey)}`;
}

function verifyWithKey(signingKey: string, input: QstashSignatureInput, signature: string): boolean {
  const [header, payload, digest] = signature.split('.');
  if (!header || !payload || !digest) return false;

  const expected = sign(`${header}.${payload}`, signingKey);
  if (!safeEqual(digest, expected)) return false;

  const claims = decodePayload(payload);
  if (!claims) return false;

  const now = Math.floor(Date.now() / 1000);
  const tolerance = input.clockToleranceSeconds ?? 30;
  if (typeof claims.exp === 'number' && now > claims.exp + tolerance) return false;
  if (typeof claims.nbf === 'number' && now + tolerance < claims.nbf) return false;
  if (claims.body !== hashBody(input.body)) return false;
  if (input.url && claims.sub && claims.sub !== input.url) return false;

  return true;
}

function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('base64url');
}

function sign(value: string, signingKey: string): string {
  return createHmac('sha256', signingKey).update(value).digest('base64url');
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodePayload(payload: string): { body?: unknown; exp?: unknown; nbf?: unknown; sub?: unknown } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null ? value as { body?: unknown; exp?: unknown; nbf?: unknown; sub?: unknown } : null;
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
