import { parseLooseJson, type CsvHeader, type CsvRecord } from '../data/csv.reader.js';
import type {
  DatasetFileType,
  DatasetImportDiagnosticInput,
} from '../../domain/dataset-import-queue.types.js';

const DATASET_HEADERS: Record<DatasetFileType, readonly string[]> = {
  credits: ['cast', 'crew', 'id'],
  links: ['movieId', 'imdbId', 'tmdbId'],
  movies: [
    'adult',
    'belongs_to_collection',
    'budget',
    'genres',
    'homepage',
    'id',
    'imdb_id',
    'original_language',
    'original_title',
    'overview',
    'popularity',
    'poster_path',
    'production_companies',
    'production_countries',
    'release_date',
    'revenue',
    'runtime',
    'spoken_languages',
    'status',
    'tagline',
    'title',
    'video',
    'vote_average',
    'vote_count',
  ],
  ratings: ['userId', 'movieId', 'rating', 'timestamp'],
};

export function validateDatasetHeaders(type: DatasetFileType, header: CsvHeader): DatasetImportDiagnosticInput[] {
  if (header.issue) {
    return [createDatasetDiagnostic({ lineEnd: header.line, lineStart: header.line }, {
      category: 'structure',
      field: null,
      message: header.issue.message,
      reason: 'invalid_header',
      ruleCode: header.issue.code,
      value: null,
    })];
  }

  if (header.line === null) {
    return [createDatasetDiagnostic({ lineEnd: null, lineStart: null }, {
      category: 'structure',
      field: null,
      message: 'O arquivo CSV nao possui cabecalho.',
      reason: 'invalid_header',
      ruleCode: 'header_required',
      value: null,
    })];
  }

  const issues: DatasetImportDiagnosticInput[] = [];
  const expectedHeaders = DATASET_HEADERS[type];
  const seenHeaders = new Set<string>();

  for (const field of header.headers) {
    if (seenHeaders.has(field)) {
      issues.push(createDatasetDiagnostic({ lineEnd: header.line, lineStart: header.line }, {
        category: 'structure',
        field,
        message: 'O cabecalho contem uma coluna duplicada.',
        reason: 'invalid_header',
        ruleCode: 'duplicate_header',
        value: field || null,
      }));
      continue;
    }

    seenHeaders.add(field);

    if (!expectedHeaders.includes(field)) {
      issues.push(createDatasetDiagnostic({ lineEnd: header.line, lineStart: header.line }, {
        category: 'structure',
        field: field || null,
        message: 'O cabecalho contem uma coluna que nao pertence ao contrato do arquivo.',
        reason: 'invalid_header',
        ruleCode: 'unexpected_header',
        value: field || null,
      }));
    }
  }

  for (const field of expectedHeaders) {
    if (seenHeaders.has(field)) {
      continue;
    }

    issues.push(createDatasetDiagnostic({ lineEnd: header.line, lineStart: header.line }, {
      category: 'structure',
      field,
      message: `O cabecalho nao contem a coluna obrigatoria ${field}.`,
      reason: 'invalid_header',
      ruleCode: 'required_header',
      value: null,
    }));
  }

  return issues;
}

export function validateDatasetRecord(type: DatasetFileType, record: CsvRecord): DatasetImportDiagnosticInput[] {
  if (record.issue) {
    return [createDatasetDiagnostic(record, {
      category: 'structure',
      field: null,
      message: record.issue.message,
      reason: 'invalid_row',
      ruleCode: record.issue.code,
      value: null,
    })];
  }

  if (type === 'movies') {
    return validateMovieRecord(record);
  }

  if (type === 'links') {
    return validateLinkRecord(record);
  }

  if (type === 'credits') {
    return validateCreditsRecord(record);
  }

  return validateRatingsRecord(record);
}

export function createDatasetDiagnostic(
  location: Pick<CsvRecord, 'lineEnd' | 'lineStart'> | { lineEnd: number | null; lineStart: number | null },
  input: Omit<DatasetImportDiagnosticInput, 'lineEnd' | 'lineStart'>,
): DatasetImportDiagnosticInput {
  return { ...input, lineEnd: location.lineEnd, lineStart: location.lineStart };
}

function validateMovieRecord(record: CsvRecord): DatasetImportDiagnosticInput[] {
  const issues: DatasetImportDiagnosticInput[] = [];
  const row = record.row;

  validateRequiredPositiveInteger(record, issues, 'id');
  validateRequiredBoolean(record, issues, 'adult');
  validateOptionalCollection(record, issues, 'belongs_to_collection');
  validateOptionalNonNegativeInteger(record, issues, 'budget');
  validateRequiredArray(record, issues, 'genres', validateGenre);
  validateUniqueNestedValues(record, issues, 'genres', 'id', normalizeNestedPositiveInteger);
  validateOptionalHttpUrl(record, issues, 'homepage');
  validateOptionalImdbId(record, issues, 'imdb_id');
  validateOptionalLanguage(record, issues, 'original_language');
  validateOptionalText(record, issues, 'original_title');
  validateOptionalText(record, issues, 'overview');
  validateOptionalNonNegativeNumber(record, issues, 'popularity');
  validateOptionalText(record, issues, 'poster_path');
  validateOptionalArray(record, issues, 'production_companies', validateProductionCompany);
  validateOptionalArray(record, issues, 'production_countries', validateProductionCountry);
  validateOptionalDate(record, issues, 'release_date');
  validateOptionalNonNegativeInteger(record, issues, 'revenue');
  validateOptionalNonNegativeInteger(record, issues, 'runtime');
  validateOptionalArray(record, issues, 'spoken_languages', validateSpokenLanguage);
  validateOptionalText(record, issues, 'status');
  validateOptionalText(record, issues, 'tagline');
  validateOptionalText(record, issues, 'title');
  validateRequiredBoolean(record, issues, 'video');
  validateOptionalNumberInRange(record, issues, 'vote_average', 0, 10);
  validateOptionalNonNegativeInteger(record, issues, 'vote_count');

  if (valueFor(row, 'title').trim().length === 0 && valueFor(row, 'original_title').trim().length === 0) {
    issues.push(createDatasetDiagnostic(record, {
      category: 'validation',
      field: 'title',
      message: 'title ou original_title deve ser informado.',
      reason: 'invalid_field',
      ruleCode: 'title_or_original_title_required',
      value: null,
    }));
  }

  return issues;
}

function validateLinkRecord(record: CsvRecord): DatasetImportDiagnosticInput[] {
  const issues: DatasetImportDiagnosticInput[] = [];

  validateRequiredPositiveInteger(record, issues, 'movieId');
  validateOptionalMovieLensImdbId(record, issues, 'imdbId');
  validateRequiredPositiveInteger(record, issues, 'tmdbId');

  return issues;
}

function validateCreditsRecord(record: CsvRecord): DatasetImportDiagnosticInput[] {
  const issues: DatasetImportDiagnosticInput[] = [];

  validateRequiredPositiveInteger(record, issues, 'id');
  validateRequiredArray(record, issues, 'cast', validateCastMember);
  validateRequiredArray(record, issues, 'crew', validateCrewMember);
  validateUniqueNestedValues(record, issues, 'cast', 'credit_id', normalizeNestedText);
  validateUniqueNestedValues(record, issues, 'crew', 'credit_id', normalizeNestedText);

  return issues;
}

function validateRatingsRecord(record: CsvRecord): DatasetImportDiagnosticInput[] {
  const issues: DatasetImportDiagnosticInput[] = [];

  validateRequiredPositiveInteger(record, issues, 'userId');
  validateRequiredPositiveInteger(record, issues, 'movieId');
  validateRating(record, issues);
  validateTimestamp(record, issues);

  return issues;
}

function validateRequiredPositiveInteger(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field);

  if (value.trim().length === 0) {
    addIssue(record, issues, field, value, 'required', 'O campo e obrigatorio.');
    return;
  }

  if (parseSafeInteger(value, false) === null) {
    addIssue(record, issues, field, value, 'positive_integer_required', 'O campo deve ser um inteiro seguro maior que zero.');
  }
}

function validateOptionalNonNegativeInteger(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field);

  if (value.trim().length === 0) {
    return;
  }

  if (parseSafeInteger(value, true) === null) {
    addIssue(record, issues, field, value, 'non_negative_integer', 'O campo deve ser um inteiro seguro maior ou igual a zero.');
  }
}

function validateRequiredBoolean(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field);

  if (!/^(true|false)$/i.test(value.trim())) {
    addIssue(record, issues, field, value, 'boolean_required', 'O campo deve ser true ou false.');
  }
}

function validateOptionalNonNegativeNumber(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field);

  if (value.trim().length === 0) {
    return;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    addIssue(record, issues, field, value, 'non_negative_number', 'O campo deve ser um numero finito maior ou igual a zero.');
  }
}

function validateOptionalNumberInRange(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, minimum: number, maximum: number): void {
  const value = valueFor(record.row, field);

  if (value.trim().length === 0) {
    return;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    addIssue(record, issues, field, value, 'number_out_of_range', `O campo deve ser um numero entre ${minimum} e ${maximum}.`);
  }
}

function validateOptionalHttpUrl(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field).trim();

  if (value.length === 0) {
    return;
  }

  if (value.split(/\s+/).every(isHttpUrl)) {
    return;
  }

  addIssue(record, issues, field, value, 'http_url', 'O campo deve ser uma ou mais URLs http ou https.');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateOptionalText(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field);

  if (value.includes('\u0000')) {
    addIssue(record, issues, field, value, 'text_control_character', 'O campo nao pode conter caracteres de controle nulos.');
  }
}

function validateOptionalImdbId(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field).trim();

  if (value.length > 0 && !/^tt\d{7,10}$/i.test(value)) {
    addIssue(record, issues, field, value, 'imdb_id', 'O campo deve seguir o formato tt seguido de 7 a 10 digitos.');
  }
}

function validateOptionalMovieLensImdbId(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field).trim();

  if (value.length > 0 && !/^\d{1,10}$/.test(value)) {
    addIssue(record, issues, field, value, 'movielens_imdb_id', 'O campo deve conter somente digitos.');
  }
}

function validateOptionalLanguage(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field).trim();

  if (value.length > 0 && !/^[a-z]{2}$/i.test(value)) {
    addIssue(record, issues, field, value, 'language_code', 'O campo deve ser um codigo ISO de idioma com duas letras.');
  }
}

function validateOptionalDate(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field).trim();

  if (value.length === 0) {
    return;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    addIssue(record, issues, field, value, 'calendar_date', 'O campo deve ser uma data no formato YYYY-MM-DD.');
    return;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (year < 100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    addIssue(record, issues, field, value, 'calendar_date', 'O campo deve conter uma data de calendario valida.');
  }
}

function validateOptionalCollection(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string): void {
  const value = valueFor(record.row, field);

  if (value.trim().length === 0) {
    return;
  }

  const parsed = parseLooseJson(value);

  if (parsed === null && /^(null|none)$/i.test(value.trim())) {
    return;
  }

  if (!isRecord(parsed)) {
    addIssue(record, issues, field, value, 'json_object', 'O campo deve conter um objeto JSON valido ou estar vazio.');
    return;
  }

  validateNestedPositiveInteger(record, issues, `${field}.id`, parsed.id, true);
  validateNestedText(record, issues, `${field}.name`, parsed.name, true);
  validateNestedNullableText(record, issues, `${field}.poster_path`, parsed.poster_path);
  validateNestedNullableText(record, issues, `${field}.backdrop_path`, parsed.backdrop_path);
}

function validateRequiredArray(
  record: CsvRecord,
  issues: DatasetImportDiagnosticInput[],
  field: string,
  validateItem: (record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number) => void,
): void {
  const value = valueFor(record.row, field);

  if (value.trim().length === 0) {
    addIssue(record, issues, field, value, 'required', 'O campo e obrigatorio e deve conter um array JSON.');
    return;
  }

  validateParsedArray(record, issues, field, value, validateItem);
}

function validateOptionalArray(
  record: CsvRecord,
  issues: DatasetImportDiagnosticInput[],
  field: string,
  validateItem: (record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number) => void,
): void {
  const value = valueFor(record.row, field);

  if (value.trim().length === 0) {
    return;
  }

  validateParsedArray(record, issues, field, value, validateItem);
}

function validateParsedArray(
  record: CsvRecord,
  issues: DatasetImportDiagnosticInput[],
  field: string,
  value: string,
  validateItem: (record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number) => void,
): void {
  const parsed = parseLooseJson(value);

  if (!Array.isArray(parsed)) {
    addIssue(record, issues, field, value, 'json_array', 'O campo deve conter um array JSON valido.');
    return;
  }

  parsed.forEach((item, index) => validateItem(record, issues, field, item, index));
}

function validateUniqueNestedValues(
  record: CsvRecord,
  issues: DatasetImportDiagnosticInput[],
  field: string,
  property: string,
  normalize: (value: unknown) => string | null,
): void {
  const parsed = parseLooseJson(valueFor(record.row, field));

  if (!Array.isArray(parsed)) {
    return;
  }

  const seen = new Set<string>();

  parsed.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }

    const normalized = normalize(item[property]);

    if (!normalized) {
      return;
    }

    if (seen.has(normalized)) {
      issues.push(createDatasetDiagnostic(record, {
        category: 'integrity',
        field: `${field}[${index}].${property}`,
        message: `O valor de ${property} deve ser unico dentro de ${field}.`,
        reason: 'duplicate_value',
        ruleCode: `${field}_${property}_unique`,
        value: String(item[property]),
      }));
      return;
    }

    seen.add(normalized);
  });
}

function validateGenre(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number): void {
  const value = validateNestedRecord(record, issues, field, item, index);

  if (!value) {
    return;
  }

  const path = `${field}[${index}]`;
  validateNestedPositiveInteger(record, issues, `${path}.id`, value.id, true);
  validateNestedText(record, issues, `${path}.name`, value.name, true);
}

function validateProductionCompany(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number): void {
  const value = validateNestedRecord(record, issues, field, item, index);

  if (!value) {
    return;
  }

  const path = `${field}[${index}]`;
  validateNestedPositiveInteger(record, issues, `${path}.id`, value.id, true);
  validateNestedText(record, issues, `${path}.name`, value.name, true);
}

function validateProductionCountry(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number): void {
  const value = validateNestedRecord(record, issues, field, item, index);

  if (!value) {
    return;
  }

  const path = `${field}[${index}]`;
  validateNestedPattern(record, issues, `${path}.iso_3166_1`, value.iso_3166_1, /^[A-Z]{2}$/, 'country_code', 'O campo deve ser um codigo de pais ISO com duas letras maiusculas.');
  validateNestedText(record, issues, `${path}.name`, value.name, true);
}

function validateSpokenLanguage(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number): void {
  const value = validateNestedRecord(record, issues, field, item, index);

  if (!value) {
    return;
  }

  const path = `${field}[${index}]`;
  validateNestedPattern(record, issues, `${path}.iso_639_1`, value.iso_639_1, /^[a-z]{2}$/i, 'language_code', 'O campo deve ser um codigo de idioma ISO com duas letras.');
  validateNestedNullableText(record, issues, `${path}.name`, value.name);
}

function validateCastMember(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number): void {
  const value = validateNestedRecord(record, issues, field, item, index);

  if (!value) {
    return;
  }

  const path = `${field}[${index}]`;
  validateNestedText(record, issues, `${path}.credit_id`, value.credit_id, true);
  validateNestedPositiveInteger(record, issues, `${path}.id`, value.id, true);
  validateNestedText(record, issues, `${path}.name`, value.name, true);
  validateNestedNonNegativeInteger(record, issues, `${path}.cast_id`, value.cast_id, false);
  validateNestedNonNegativeInteger(record, issues, `${path}.order`, value.order, true);
  validateNestedGender(record, issues, `${path}.gender`, value.gender);
  validateNestedNullableText(record, issues, `${path}.character`, value.character);
  validateNestedNullableText(record, issues, `${path}.profile_path`, value.profile_path);
}

function validateCrewMember(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number): void {
  const value = validateNestedRecord(record, issues, field, item, index);

  if (!value) {
    return;
  }

  const path = `${field}[${index}]`;
  validateNestedText(record, issues, `${path}.credit_id`, value.credit_id, true);
  validateNestedPositiveInteger(record, issues, `${path}.id`, value.id, true);
  validateNestedText(record, issues, `${path}.name`, value.name, true);
  validateNestedText(record, issues, `${path}.department`, value.department, true);
  validateNestedText(record, issues, `${path}.job`, value.job, true);
  validateNestedGender(record, issues, `${path}.gender`, value.gender);
  validateNestedNullableText(record, issues, `${path}.profile_path`, value.profile_path);
}

function validateNestedRecord(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, item: unknown, index: number): Record<string, unknown> | null {
  if (isRecord(item)) {
    return item;
  }

  addIssue(record, issues, `${field}[${index}]`, item === null ? null : String(item), 'json_object', 'Cada item do array deve ser um objeto JSON.');
  return null;
}

function validateNestedPositiveInteger(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, value: unknown, required: boolean): void {
  if (isEmptyNestedValue(value)) {
    if (required) {
      addIssue(record, issues, field, value === null || value === undefined ? null : String(value), 'required', 'O campo e obrigatorio.');
    }
    return;
  }

  if (parseSafeInteger(String(value), false) === null) {
    addIssue(record, issues, field, String(value), 'positive_integer_required', 'O campo deve ser um inteiro seguro maior que zero.');
  }
}

function validateNestedNonNegativeInteger(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, value: unknown, required: boolean): void {
  if (isEmptyNestedValue(value)) {
    if (required) {
      addIssue(record, issues, field, value === null || value === undefined ? null : String(value), 'required', 'O campo e obrigatorio.');
    }
    return;
  }

  if (parseSafeInteger(String(value), true) === null) {
    addIssue(record, issues, field, String(value), 'non_negative_integer', 'O campo deve ser um inteiro seguro maior ou igual a zero.');
  }
}

function validateNestedText(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, value: unknown, required: boolean): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    return;
  }

  if (required || value !== undefined) {
    addIssue(record, issues, field, value === null || value === undefined ? null : String(value), required ? 'required' : 'text', required ? 'O campo e obrigatorio.' : 'O campo deve ser texto.');
  }
}

function validateNestedNullableText(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, value: unknown): void {
  if (value === null || value === undefined || typeof value === 'string') {
    return;
  }

  addIssue(record, issues, field, String(value), 'nullable_text', 'O campo deve ser texto ou null.');
}

function validateNestedPattern(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, value: unknown, pattern: RegExp, ruleCode: string, message: string): void {
  if (typeof value === 'string' && pattern.test(value.trim())) {
    return;
  }

  addIssue(record, issues, field, value === null || value === undefined ? null : String(value), ruleCode, message);
}

function validateNestedGender(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, value: unknown): void {
  if (value === null || value === undefined || value === '') {
    return;
  }

  const gender = parseSafeInteger(String(value), true);

  if (gender === null || gender > 2) {
    addIssue(record, issues, field, String(value), 'gender_range', 'O campo deve ser um inteiro entre 0 e 2.');
  }
}

function validateRating(record: CsvRecord, issues: DatasetImportDiagnosticInput[]): void {
  const field = 'rating';
  const value = valueFor(record.row, field);
  const rating = Number(value);

  if (value.trim().length === 0) {
    addIssue(record, issues, field, value, 'required', 'O campo e obrigatorio.');
    return;
  }

  if (!Number.isFinite(rating) || rating < 0.5 || rating > 5 || Math.abs(rating * 2 - Math.round(rating * 2)) > Number.EPSILON) {
    addIssue(record, issues, field, value, 'rating_scale', 'O campo deve estar entre 0.5 e 5 em incrementos de 0.5.');
  }
}

function validateTimestamp(record: CsvRecord, issues: DatasetImportDiagnosticInput[]): void {
  const field = 'timestamp';
  const value = valueFor(record.row, field);
  const timestamp = parseSafeInteger(value, false);

  if (timestamp === null) {
    addIssue(record, issues, field, value, value.trim().length === 0 ? 'required' : 'unix_timestamp', value.trim().length === 0 ? 'O campo e obrigatorio.' : 'O campo deve ser um timestamp Unix inteiro maior que zero.');
    return;
  }

  if (timestamp > 8_640_000_000_000) {
    addIssue(record, issues, field, value, 'unix_timestamp_range', 'O campo esta fora da faixa de datas suportada.');
  }
}

function addIssue(record: CsvRecord, issues: DatasetImportDiagnosticInput[], field: string, value: string | null, ruleCode: string, message: string): void {
  issues.push(createDatasetDiagnostic(record, {
    category: 'validation',
    field,
    message,
    reason: 'invalid_field',
    ruleCode,
    value,
  }));
}

function parseSafeInteger(value: string, allowZero: boolean): number | null {
  const normalized = value.trim();

  if (!/^\d+(?:\.0+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed) || (!allowZero && parsed <= 0) || (allowZero && parsed < 0)) {
    return null;
  }

  return parsed;
}

function normalizeNestedPositiveInteger(value: unknown): string | null {
  const parsed = parseSafeInteger(String(value ?? ''), false);
  return parsed === null ? null : String(parsed);
}

function normalizeNestedText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isEmptyNestedValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim().length === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueFor(row: Record<string, string>, field: string): string {
  return row[field] ?? '';
}
