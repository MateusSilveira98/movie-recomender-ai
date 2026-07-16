import { RUNTIME_PREFERENCE_OPTIONS } from '../../../../../../packages/shared/src/entities/consts/runtime-preference-options.const.js';
import type { RuntimePreference } from '../../../../../../packages/shared/src/entities/types/runtime-preference.type.js';
import type { ValidationResult } from '../../../app/types/validation-result.type.js';
import type { MovieFilter } from '../entities/movie-filter.entity.js';

const DEFAULT_MOVIE_LIMIT = 10;
const MAX_MOVIE_LIMIT = 20;

export function validateMovieQuery(query: unknown): ValidationResult<MovieFilter> {
  if (!isRecord(query)) {
    return { valid: true, data: { genres: [], runtime: 'any', limit: DEFAULT_MOVIE_LIMIT } };
  }

  const genresResult = parseStringListParam(query.genres);
  const runtimeResult = parseRuntimeParam(query.runtime);
  const limitResult = parseLimitParam(query.limit);

  if (!genresResult.valid) {
    return { valid: false, error: 'genres deve ser uma string ou lista de strings separadas por virgula.' };
  }

  if (!runtimeResult.valid) {
    return { valid: false, error: runtimeResult.error };
  }

  if (!limitResult.valid) {
    return { valid: false, error: limitResult.error };
  }

  return {
    valid: true,
    data: {
      genres: genresResult.data,
      runtime: runtimeResult.data,
      limit: limitResult.data,
    },
  };
}

function parseStringListParam(value: unknown): ValidationResult<string[]> {
  if (value === undefined) {
    return { valid: true, data: [] };
  }

  if (typeof value === 'string') {
    return { valid: true, data: splitAndTrim(value) };
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return { valid: true, data: value.flatMap(splitAndTrim) };
  }

  return { valid: false, error: 'parametro invalido.' };
}

function parseRuntimeParam(value: unknown): ValidationResult<RuntimePreference> {
  if (value === undefined) {
    return { valid: true, data: 'any' };
  }

  if (!isSingleString(value) || !isRuntimePreference(value)) {
    return { valid: false, error: 'runtime deve ser any, short, medium ou long.' };
  }

  return { valid: true, data: value };
}

function parseLimitParam(value: unknown): ValidationResult<number> {
  if (value === undefined) {
    return { valid: true, data: DEFAULT_MOVIE_LIMIT };
  }

  if (!isSingleString(value)) {
    return { valid: false, error: `limit deve ser um numero inteiro entre 1 e ${MAX_MOVIE_LIMIT}.` };
  }

  const parsedLimit = Number(value);

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_MOVIE_LIMIT) {
    return { valid: false, error: `limit deve ser um numero inteiro entre 1 e ${MAX_MOVIE_LIMIT}.` };
  }

  return { valid: true, data: parsedLimit };
}

function splitAndTrim(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isRuntimePreference(value: string): value is RuntimePreference {
  return RUNTIME_PREFERENCE_OPTIONS.some((option) => option.value === value);
}

function isSingleString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
