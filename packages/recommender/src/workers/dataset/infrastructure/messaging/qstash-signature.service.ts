import { createHash, createHmac } from 'node:crypto';
import { Receiver } from '@upstash/qstash';

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

export async function verifyQstashSignature(keys: QstashSignatureKeys, input: QstashSignatureInput): Promise<boolean> {
  const signature = input.signature.trim();
  if (!signature) return false;

  const receiver = new Receiver({
    currentSigningKey: keys.currentSigningKey,
    nextSigningKey: keys.nextSigningKey,
  });

  try {
    await receiver.verify({
      body: input.body,
      clockTolerance: input.clockToleranceSeconds ?? 30,
      signature,
      url: input.url,
    });
    return true;
  } catch {
    return false;
  }
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

function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('base64url');
}

function sign(value: string, signingKey: string): string {
  return createHmac('sha256', signingKey).update(value).digest('base64url');
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
