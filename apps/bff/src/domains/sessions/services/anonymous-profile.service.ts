import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { isAllowedWebOrigin, isCrossSiteWebOrigin } from '../../../app/web-origin.js';
import type { SessionRepository, StoredAnonymousProfile } from '../repositories/sessions.repository.js';

const ANONYMOUS_PROFILE_COOKIE = 'movie_recommender_profile';
const PROFILE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface ResolvedAnonymousProfile {
  csrfToken: string;
  profile: StoredAnonymousProfile;
}

export interface AnonymousProfileService {
  getOrCreate(request: Request, response: Response): Promise<ResolvedAnonymousProfile>;
  requireForMutation(request: Request): Promise<ResolvedAnonymousProfile | null>;
}

export function createAnonymousProfileService(sessionRepository: SessionRepository): AnonymousProfileService {
  return {
    async getOrCreate(request, response) {
      const nowMs = Date.now();
      await sessionRepository.cleanupExpired(nowMs);
      const token = readCookie(request, ANONYMOUS_PROFILE_COOKIE);
      const existing = token
        ? await sessionRepository.findActiveProfileByTokenHash(hashToken(token), nowMs)
        : null;

      if (existing && token) {
        const expiresAtMs = nowMs + PROFILE_TTL_MS;
        const touched = await sessionRepository.touchProfile(existing.id, nowMs, expiresAtMs);

        if (touched) {
          response.cookie(ANONYMOUS_PROFILE_COOKIE, token, cookieOptions(request.get('origin')));

          return { csrfToken: createCsrfToken(token), profile: { ...existing, expiresAtMs } };
        }
      }

      const nextToken = createToken();
      const expiresAtMs = nowMs + PROFILE_TTL_MS;
      const profile = await sessionRepository.createAnonymousProfile(randomUUID(), hashToken(nextToken), nowMs, expiresAtMs);
      response.cookie(ANONYMOUS_PROFILE_COOKIE, nextToken, cookieOptions(request.get('origin')));

      return { csrfToken: createCsrfToken(nextToken), profile };
    },
    async requireForMutation(request) {
      const token = readCookie(request, ANONYMOUS_PROFILE_COOKIE);
      const origin = request.get('origin');

      if (!token || !origin || !isAllowedWebOrigin(origin) || !matchesCsrfToken(request.get('x-csrf-token'), createCsrfToken(token))) {
        return null;
      }

      const nowMs = Date.now();
      await sessionRepository.cleanupExpired(nowMs);
      const profile = await sessionRepository.findActiveProfileByTokenHash(hashToken(token), nowMs);

      if (!profile) {
        return null;
      }

      const expiresAtMs = nowMs + PROFILE_TTL_MS;
      const touched = await sessionRepository.touchProfile(profile.id, nowMs, expiresAtMs);

      return touched ? { csrfToken: createCsrfToken(token), profile: { ...profile, expiresAtMs } } : null;
    },
  };
}

function cookieOptions(origin: string | undefined) {
  const sameSite = isCrossSiteWebOrigin(origin) ? 'none' : 'lax';
  const production = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';

  return {
    httpOnly: true,
    maxAge: PROFILE_TTL_MS,
    path: '/',
    sameSite,
    secure: production || sameSite === 'none',
  } as const;
}

function createCsrfToken(token: string): string {
  return createHash('sha256').update(`csrf:${token}`).digest('hex');
}

function createToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function matchesCsrfToken(candidate: string | undefined, expected: string): boolean {
  if (!candidate || candidate.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function readCookie(request: Request, name: string): string | null {
  const rawCookies = request.get('cookie');

  if (!rawCookies) {
    return null;
  }

  for (const part of rawCookies.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');

    if (rawName === name) {
      return rawValue.join('=') || null;
    }
  }

  return null;
}
