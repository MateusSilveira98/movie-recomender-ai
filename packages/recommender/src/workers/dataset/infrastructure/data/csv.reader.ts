import { createReadStream } from 'node:fs';
import { TextDecoder } from 'node:util';
import JSON5 from 'json5';

export const DEFAULT_CSV_RECORD_MAX_LENGTH = 1024 * 1024;

export interface CsvReadOptions {
  maxRecordLength?: number;
}

export interface CsvHeader {
  headers: string[];
  issue: CsvSyntaxIssue | null;
  line: number | null;
}

export interface CsvRecord {
  issue: CsvSyntaxIssue | null;
  lineEnd: number;
  lineStart: number;
  row: Record<string, string>;
}

export interface CsvSyntaxIssue {
  code: 'invalid_column_count' | 'invalid_csv_syntax' | 'record_too_large';
  message: string;
}

interface CsvLogicalRecord {
  issue: CsvSyntaxIssue | null;
  lineEnd: number;
  lineStart: number;
  values: string[];
}

type CsvParserState = 'after_quote' | 'field' | 'quoted_field';

export function readCsv(filePath: string, options?: CsvReadOptions): AsyncGenerator<Record<string, string>> {
  return (async function* generator() {
    for await (const record of readCsvRecords(filePath, options)) {
      yield record.row;
    }
  })();
}

export function readCsvRecords(filePath: string, options?: CsvReadOptions): AsyncGenerator<CsvRecord> {
  return (async function* generator() {
    let headers: string[] | null = null;

    for await (const logicalRecord of readCsvLogicalRecords(filePath, options)) {
      if (!headers) {
        headers = logicalRecord.issue ? [] : normalizeHeaders(logicalRecord.values);
        continue;
      }

      if (logicalRecord.issue) {
        yield createCsvRecord(headers, logicalRecord.lineStart, logicalRecord.lineEnd, {}, logicalRecord.issue);
        continue;
      }

      if (logicalRecord.values.length !== headers.length) {
        yield createCsvRecord(
          headers,
          logicalRecord.lineStart,
          logicalRecord.lineEnd,
          {},
          { code: 'invalid_column_count', message: `A linha possui ${logicalRecord.values.length} colunas, mas o cabecalho possui ${headers.length}.` },
        );
        continue;
      }

      yield createCsvRecord(headers, logicalRecord.lineStart, logicalRecord.lineEnd, toRow(headers, logicalRecord.values), null);
    }
  })();
}

export async function readCsvHeader(filePath: string, options?: CsvReadOptions): Promise<CsvHeader> {
  for await (const record of readCsvLogicalRecords(filePath, options)) {
    return {
      headers: record.issue ? [] : normalizeHeaders(record.values),
      issue: record.issue,
      line: record.lineStart,
    };
  }

  return { headers: [], issue: null, line: null };
}

export async function readCsvHeaders(filePath: string, options?: CsvReadOptions): Promise<string[]> {
  return (await readCsvHeader(filePath, options)).headers;
}

export async function hasValidUtf8Encoding(filePath: string): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const input = createReadStream(filePath);

  try {
    for await (const chunk of input) {
      decoder.decode(chunk, { stream: true });
    }

    decoder.decode();
    return true;
  } catch {
    input.destroy();
    return false;
  }
}

export function parseCsvLine(line: string): string[] {
  return parseCsvRecord(line).values;
}

export function parseLooseArray(value: string): unknown[] {
  const parsed = parseLooseJson(value);

  return Array.isArray(parsed) ? parsed : [];
}

export function parseLooseJson(value: string): unknown {
  if (value.trim().length === 0) {
    return null;
  }

  const normalized = value
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/""/g, '"');

  try {
    return JSON5.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

export function parseNumber(value: string): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function parsePositiveInteger(value: string): number | null {
  const normalized = value.trim();

  if (!/^\d+(?:\.0+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function* readCsvLogicalRecords(filePath: string, options?: CsvReadOptions): AsyncGenerator<CsvLogicalRecord> {
  const parser = new StreamingCsvParser(resolveMaxRecordLength(options));
  const input = createReadStream(filePath, { encoding: 'utf8' });

  try {
    for await (const chunk of input) {
      for (const record of parser.write(String(chunk))) {
        yield record;
      }
    }

    for (const record of parser.finish()) {
      yield record;
    }
  } finally {
    input.destroy();
  }
}

class StreamingCsvParser {
  private currentField = '';
  private currentFieldHasData = false;
  private fields: string[] = [];
  private issue: CsvSyntaxIssue | null = null;
  private lineNumber = 1;
  private pendingCarriageReturn = false;
  private recordActive = false;
  private recordLength = 0;
  private recordLineEnd = 1;
  private recordLineStart = 1;
  private recordOnlyWhitespace = true;
  private recordTooLarge = false;
  private state: CsvParserState = 'field';

  constructor(private readonly maxRecordLength: number) {}

  write(chunk: string): CsvLogicalRecord[] {
    const records: CsvLogicalRecord[] = [];

    for (const character of chunk) {
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;

        if (character === '\n') {
          this.pushRecord(records, this.consumeLineBreak());
          continue;
        }

        this.pushRecord(records, this.consumeLineBreak());
      }

      if (character === '\r') {
        this.pendingCarriageReturn = true;
        continue;
      }

      if (character === '\n') {
        this.pushRecord(records, this.consumeLineBreak());
        continue;
      }

      this.consumeCharacter(character);
    }

    return records;
  }

  finish(): CsvLogicalRecord[] {
    const records: CsvLogicalRecord[] = [];

    if (this.pendingCarriageReturn) {
      this.pendingCarriageReturn = false;
      this.pushRecord(records, this.consumeLineBreak());
    }

    this.pushRecord(records, this.finishRecord());
    return records;
  }

  private consumeCharacter(character: string): void {
    this.startRecord();
    this.recordLineEnd = this.lineNumber;
    this.recordLength += character.length;

    if (character.trim().length > 0) {
      this.recordOnlyWhitespace = false;
    }

    if (this.recordLength > this.maxRecordLength) {
      this.recordTooLarge = true;
      this.currentField = '';
      this.fields = [];
    }

    if (this.issue) {
      return;
    }

    if (this.state === 'quoted_field') {
      if (character === '"') {
        this.state = 'after_quote';
        return;
      }

      this.appendToField(character);
      return;
    }

    if (this.state === 'after_quote') {
      if (character === '"') {
        this.appendToField('"');
        this.state = 'quoted_field';
        return;
      }

      if (character === ',') {
        this.pushField();
        this.state = 'field';
        return;
      }

      this.markInvalidSyntax('Foram encontrados caracteres apos o fechamento de aspas.');
      return;
    }

    if (character === ',') {
      this.pushField();
      return;
    }

    if (character === '"') {
      if (this.currentFieldHasData) {
        this.markInvalidSyntax('Aspas fora de uma coluna CSV valida.');
        return;
      }

      this.state = 'quoted_field';
      return;
    }

    this.appendToField(character);
  }

  private consumeLineBreak(): CsvLogicalRecord | null {
    if (!this.recordActive) {
      this.lineNumber += 1;
      return null;
    }

    if (this.state === 'quoted_field' && !this.issue) {
      this.recordLineEnd = this.lineNumber;
      this.recordLength += 1;

      if (this.recordLength > this.maxRecordLength) {
        this.recordTooLarge = true;
        this.currentField = '';
        this.fields = [];
      }

      this.appendToField('\n');
      this.lineNumber += 1;
      return null;
    }

    const record = this.finishRecord();
    this.lineNumber += 1;
    return record;
  }

  private finishRecord(): CsvLogicalRecord | null {
    if (!this.recordActive) {
      return null;
    }

    const lineEnd = this.recordLineEnd;
    const lineStart = this.recordLineStart;
    let issue: CsvSyntaxIssue | null = this.recordTooLarge && !this.recordOnlyWhitespace
      ? {
        code: 'record_too_large',
        message: `O registro CSV excede o limite de ${this.maxRecordLength} caracteres.`,
      }
      : this.issue;

    if (!issue && this.state === 'quoted_field') {
      issue = { code: 'invalid_csv_syntax', message: 'Campo entre aspas nao foi fechado.' };
    }

    if (!issue && !this.recordOnlyWhitespace) {
      this.pushField();
    }

    const record = this.recordOnlyWhitespace && !issue
      ? null
      : { issue, lineEnd, lineStart, values: issue ? [] : this.fields };

    this.resetRecord();
    return record;
  }

  private appendToField(value: string): void {
    this.currentFieldHasData = true;

    if (!this.recordTooLarge) {
      this.currentField += value;
    }
  }

  private markInvalidSyntax(message: string): void {
    this.issue = { code: 'invalid_csv_syntax', message };
  }

  private pushField(): void {
    if (!this.recordTooLarge) {
      this.fields.push(this.currentField);
    }

    this.currentField = '';
    this.currentFieldHasData = false;
  }

  private pushRecord(records: CsvLogicalRecord[], record: CsvLogicalRecord | null): void {
    if (record) {
      records.push(record);
    }
  }

  private resetRecord(): void {
    this.currentField = '';
    this.currentFieldHasData = false;
    this.fields = [];
    this.issue = null;
    this.recordActive = false;
    this.recordLength = 0;
    this.recordOnlyWhitespace = true;
    this.recordTooLarge = false;
    this.state = 'field';
  }

  private startRecord(): void {
    if (this.recordActive) {
      return;
    }

    this.recordActive = true;
    this.recordLineStart = this.lineNumber;
    this.recordLineEnd = this.lineNumber;
  }
}

function resolveMaxRecordLength(options?: CsvReadOptions): number {
  const maxRecordLength = options?.maxRecordLength ?? DEFAULT_CSV_RECORD_MAX_LENGTH;

  if (!Number.isSafeInteger(maxRecordLength) || maxRecordLength < 1) {
    throw new RangeError('maxRecordLength deve ser um inteiro positivo.');
  }

  return maxRecordLength;
}

function parseCsvRecord(value: string): { incomplete: boolean; issue: CsvSyntaxIssue | null; values: string[] } {
  const values: string[] = [];
  let current = '';
  let closedQuotedField = false;
  let insideQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];

    if (insideQuotes && character === '"') {
      if (nextCharacter === '"') {
        current += '"';
        index += 1;
        continue;
      }

      insideQuotes = false;
      closedQuotedField = true;
      continue;
    }

    if (!insideQuotes && character === '"') {
      if (current.length > 0 || closedQuotedField) {
        return { incomplete: false, issue: { code: 'invalid_csv_syntax', message: 'Aspas fora de uma coluna CSV valida.' }, values };
      }

      insideQuotes = true;
      continue;
    }

    if (!insideQuotes && character === ',') {
      values.push(current);
      current = '';
      closedQuotedField = false;
      continue;
    }

    if (!insideQuotes && closedQuotedField) {
      return { incomplete: false, issue: { code: 'invalid_csv_syntax', message: 'Foram encontrados caracteres apos o fechamento de aspas.' }, values };
    }

    current += character;
  }

  if (insideQuotes) {
    return { incomplete: true, issue: null, values };
  }

  values.push(current);
  return { incomplete: false, issue: null, values: values.map((item) => item.replace(/\r$/, '')) };
}

function toRow(headers: string[], values: string[]): Record<string, string> {
  const row: Record<string, string> = {};

  headers.forEach((header, index) => {
    row[header] = values[index] ?? '';
  });

  return row;
}

function createCsvRecord(headers: string[], lineStart: number, lineEnd: number, row: Record<string, string>, issue: CsvSyntaxIssue | null): CsvRecord {
  return { issue, lineEnd, lineStart, row: issue ? Object.fromEntries(headers.map((header) => [header, ''])) : row };
}

function normalizeHeaders(headers: string[]): string[] {
  return headers.map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim());
}
