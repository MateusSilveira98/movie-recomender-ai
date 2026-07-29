import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import JSON5 from 'json5';

export function readCsv(filePath: string): AsyncGenerator<Record<string, string>> {
  return (async function* generator() {
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const reader = createInterface({ input, crlfDelay: Infinity });
    let headers: string[] | null = null;

    for await (const line of reader) {
      if (line.trim().length === 0) {
        continue;
      }

      if (!headers) {
        headers = parseCsvLine(line);
        continue;
      }

      const values = parseCsvLine(line);
      const row: Record<string, string> = {};

      headers.forEach((header, index) => {
        row[header] = values[index] ?? '';
      });

      yield row;
    }
  })();
}

export async function readCsvHeaders(filePath: string): Promise<string[]> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    if (line.trim().length > 0) {
      reader.close();
      input.destroy();
      return parseCsvLine(line);
    }
  }

  return [];
}

export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
        continue;
      }

      insideQuotes = !insideQuotes;
      continue;
    }

    if (character === ',' && !insideQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current);

  return values.map((value) => value.replace(/\r$/, ''));
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
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
