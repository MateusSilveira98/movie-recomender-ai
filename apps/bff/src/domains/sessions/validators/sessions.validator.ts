import { RUNTIME_PREFERENCE_OPTIONS } from '@pkg/shared/entities/consts/runtime-preference-options.const';
import type { CreateSessionRequest } from '@pkg/shared/entities/models/create-session-request.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { SessionFeedbackRequest } from '@pkg/shared/entities/models/session-feedback-request.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { RuntimePreference } from '@pkg/shared/entities/types/runtime-preference.type';
import type { SessionFeedback } from '@pkg/shared/entities/types/session-feedback.type';
import { MOVIE_CATALOG_MOCK } from '@pkg/shared/mocks/movie';
import type { ValidationResult } from '../../../app/types/validation-result.type.js';

const RUNTIME_PREFERENCE_VALUES = RUNTIME_PREFERENCE_OPTIONS.map((option) => option.value);
const SESSION_FEEDBACK_VALUES: SessionFeedback[] = ['liked', 'disliked', 'watched_neutral', 'blocked'];

export function validateCreateSessionRequest(body: unknown): ValidationResult<CreateSessionRequest> {
  if (!isRecord(body)) {
    return { valid: false, error: 'Corpo da requisicao invalido.' };
  }

  const preferencesResult = validatePreferences(body.preferences);

  if (!preferencesResult.valid) {
    return preferencesResult;
  }

  const historyResult = validateOptionalHistory(body.history);

  if (!historyResult.valid) {
    return historyResult;
  }

  return {
    valid: true,
    data: {
      preferences: preferencesResult.data,
      history: historyResult.data,
    },
  };
}

export function validateSessionFeedbackRequest(body: unknown): ValidationResult<SessionFeedbackRequest> {
  if (!isRecord(body)) {
    return { valid: false, error: 'Corpo da requisicao invalido.' };
  }

  const movieId = body.movieId;

  if (typeof movieId !== 'string' || movieId.trim().length === 0) {
    return { valid: false, error: 'movieId e obrigatorio.' };
  }

  if (!MOVIE_CATALOG_MOCK.some((movie) => movie.id === movieId)) {
    return { valid: false, error: `Filme ${movieId} nao encontrado no catalogo.` };
  }

  const feedback = body.feedback;

  if (!isValidSessionFeedback(feedback)) {
    return { valid: false, error: 'feedback invalido.' };
  }

  return { valid: true, data: { movieId, feedback } };
}

function validatePreferences(value: unknown): ValidationResult<Preferences> {
  if (!isRecord(value)) {
    return { valid: false, error: 'preferences e obrigatorio.' };
  }

  const genres = value.genres;

  if (!isStringArray(genres)) {
    return { valid: false, error: 'preferences.genres deve ser uma lista de strings.' };
  }

  const runtime = value.runtime;

  if (!isValidRuntimePreference(runtime)) {
    return { valid: false, error: 'preferences.runtime invalido.' };
  }

  const freeText = value.freeText;

  if (typeof freeText !== 'string') {
    return { valid: false, error: 'preferences.freeText deve ser uma string.' };
  }

  return {
    valid: true,
    data: { genres, runtime, freeText },
  };
}

function validateOptionalHistory(value: unknown): ValidationResult<ViewerHistory | undefined> {
  if (value === undefined) {
    return { valid: true, data: undefined };
  }

  if (!isRecord(value)) {
    return { valid: false, error: 'history invalido.' };
  }

  const watched = value.watched;
  const liked = value.liked;
  const disliked = value.disliked;

  if (!isStringArray(watched) || !isStringArray(liked) || !isStringArray(disliked)) {
    return { valid: false, error: 'history deve conter watched, liked e disliked como listas de strings.' };
  }

  return { valid: true, data: { watched, liked, disliked } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidRuntimePreference(value: unknown): value is RuntimePreference {
  return typeof value === 'string' && RUNTIME_PREFERENCE_VALUES.includes(value as RuntimePreference);
}

function isValidSessionFeedback(value: unknown): value is SessionFeedback {
  return typeof value === 'string' && SESSION_FEEDBACK_VALUES.includes(value as SessionFeedback);
}
