import { RUNTIME_PREFERENCE_OPTIONS } from '@pkg/shared/entities/consts/runtime-preference-options.const';
import type { CreateSessionRequest } from '@pkg/shared/entities/models/create-session-request.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { SessionFeedbackRequest } from '@pkg/shared/entities/models/session-feedback-request.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { RuntimePreference } from '@pkg/shared/entities/types/runtime-preference.type';
import type { SessionFeedback } from '@pkg/shared/entities/types/session-feedback.type';
import type { ValidationResult } from '../../../app/types/validation-result.type.js';

const MAX_FREE_TEXT_LENGTH = 500;
const MAX_GENRES = 20;
const MAX_HISTORY_ITEMS = 100;
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

  const impressionId = body.impressionId;

  if (typeof impressionId !== 'string' || !isUuid(impressionId)) {
    return { valid: false, error: 'impressionId invalido.' };
  }

  const feedback = body.feedback;

  if (!isValidSessionFeedback(feedback)) {
    return { valid: false, error: 'feedback invalido.' };
  }

  return { valid: true, data: { feedback, impressionId } };
}

function validatePreferences(value: unknown): ValidationResult<Preferences> {
  if (!isRecord(value)) {
    return { valid: false, error: 'preferences e obrigatorio.' };
  }

  const genres = value.genres;

  if (!isStringArray(genres) || genres.length > MAX_GENRES) {
    return { valid: false, error: 'preferences.genres deve ser uma lista de strings.' };
  }

  const runtime = value.runtime;

  if (!isValidRuntimePreference(runtime)) {
    return { valid: false, error: 'preferences.runtime invalido.' };
  }

  const freeText = value.freeText;

  if (typeof freeText !== 'string' || freeText.length > MAX_FREE_TEXT_LENGTH) {
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

  if (watched.length > MAX_HISTORY_ITEMS || liked.length > MAX_HISTORY_ITEMS || disliked.length > MAX_HISTORY_ITEMS) {
    return { valid: false, error: 'history excede o limite permitido.' };
  }

  return { valid: true, data: { watched, liked, disliked } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 128);
}

function isValidRuntimePreference(value: unknown): value is RuntimePreference {
  return typeof value === 'string' && RUNTIME_PREFERENCE_VALUES.includes(value as RuntimePreference);
}

function isValidSessionFeedback(value: unknown): value is SessionFeedback {
  return typeof value === 'string' && SESSION_FEEDBACK_VALUES.includes(value as SessionFeedback);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
