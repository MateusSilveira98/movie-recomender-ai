import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { toMovieRecord } from '../mappers/movie-record.mapper.js';
import { validateDatasetRecord } from '../validation/dataset-csv.validator.js';
import { hasValidUtf8Encoding, parseCsvLine, parseLooseArray, parseLooseJson, parsePositiveInteger, readCsv, readCsvHeader, readCsvRecords } from './csv.reader.js';

describe('leitor do dataset', () => {
  it('deve preservar vírgulas dentro de campos CSV entre aspas', () => {
    const values = parseCsvLine('1,"titulo, com virgula",filme');

    assert.deepEqual(values, ['1', 'titulo, com virgula', 'filme']);
  });

  it('deve preservar quebras de linha dentro de campos CSV entre aspas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-csv-'));
    const filePath = join(directory, 'movies.csv');

    try {
      await writeFile(filePath, 'id,title,overview\n1,Filme,"Primeira linha\nSegunda linha"\n');
      const rows: Array<Record<string, string>> = [];

      for await (const row of readCsv(filePath)) {
        rows.push(row);
      }

      assert.deepEqual(rows, [{ id: '1', overview: 'Primeira linha\nSegunda linha', title: 'Filme' }]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve informar a faixa física de uma linha lógica multilinha', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-csv-'));
    const filePath = join(directory, 'movies.csv');

    try {
      await writeFile(filePath, 'id,title,overview\n1,Filme,"Primeira linha\nSegunda linha"\n');
      const records = [];

      for await (const record of readCsvRecords(filePath)) {
        records.push(record);
      }

      assert.deepEqual(records.map((record) => ({ issue: record.issue, lineEnd: record.lineEnd, lineStart: record.lineStart })), [
        { issue: null, lineEnd: 3, lineStart: 2 },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve preservar BOM, CRLF e aspas escapadas em um registro que atravessa chunks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-csv-'));
    const filePath = join(directory, 'movies.csv');
    const titlePrefix = 'a'.repeat(65_510);

    try {
      await writeFile(filePath, `\uFEFFid,title,overview\r\n1,"${titlePrefix}"" especial","Primeira linha\r\nSegunda linha"\r\n`);
      const records = [];

      for await (const record of readCsvRecords(filePath)) {
        records.push(record);
      }

      assert.deepEqual(records, [{
        issue: null,
        lineEnd: 3,
        lineStart: 2,
        row: {
          id: '1',
          overview: 'Primeira linha\nSegunda linha',
          title: `${titlePrefix}" especial`,
        },
      }]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve rejeitar registro lógico maior que o limite e continuar a leitura', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-csv-'));
    const filePath = join(directory, 'movies.csv');

    try {
      await writeFile(filePath, `id,title\n1,"${'conteúdo longo '.repeat(10_000)}\ncontinua"\n2,Válido\n`);
      const records = [];

      for await (const record of readCsvRecords(filePath, { maxRecordLength: 64 })) {
        records.push(record);
      }

      assert.deepEqual(records, [
        {
          issue: {
            code: 'record_too_large',
            message: 'O registro CSV excede o limite de 64 caracteres.',
          },
          lineEnd: 3,
          lineStart: 2,
          row: { id: '', title: '' },
        },
        {
          issue: null,
          lineEnd: 4,
          lineStart: 4,
          row: { id: '2', title: 'Válido' },
        },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve rejeitar cabeçalho maior que o limite de registro', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-csv-'));
    const filePath = join(directory, 'movies.csv');

    try {
      await writeFile(filePath, `${'coluna,'.repeat(20)}final\n1,Filme\n`);
      const header = await readCsvHeader(filePath, { maxRecordLength: 32 });

      assert.deepEqual(header, {
        headers: [],
        issue: {
          code: 'record_too_large',
          message: 'O registro CSV excede o limite de 32 caracteres.',
        },
        line: 1,
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve identificar uma linha com quantidade de colunas inválida', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-csv-'));
    const filePath = join(directory, 'movies.csv');

    try {
      await writeFile(filePath, 'id,title\n1,Filme,extra\n');

      const rows = [];

      for await (const row of readCsv(filePath)) {
        rows.push(row);
      }

      assert.deepEqual(rows, [{ id: '', title: '' }]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve rejeitar arquivo que não usa UTF-8 válido', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'movie-recommender-csv-'));
    const filePath = join(directory, 'invalid.csv');

    try {
      await writeFile(filePath, Buffer.from([0xc3, 0x28]));

      assert.equal(await hasValidUtf8Encoding(filePath), false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deve rejeitar identificador parcialmente numérico e aceitar decimal que representa inteiro', () => {
    const links = { byMovieLensId: new Map(), byTmdbId: new Map() };
    const validMovie = toMovieRecord(movieRow({ id: '42', original_title: 'Título original', title: '' }), links);
    const invalidMovie = toMovieRecord(movieRow({ id: '2012-09-29', original_title: 'Título original', title: '' }), links);

    assert.equal(parsePositiveInteger('2012-09-29'), null);
    assert.equal(parsePositiveInteger('108.0'), 108);
    assert.equal(validMovie?.title, 'Título original');
    assert.equal(invalidMovie, null);
  });

  it('deve aceitar pseudo-JSON do dataset', () => {
    const values = parseLooseArray("[{'name': 'Pessoa', 'adult': False}]");

    assert.deepEqual(values, [{ name: 'Pessoa', adult: false }]);
  });

  it('deve retornar nulo para pseudo-JSON inválido', () => {
    const value = parseLooseJson("[{'name':]");

    assert.equal(value, null);
  });

  it('deve validar todos os campos relevantes de um registro de filmes', () => {
    const issues = validateDatasetRecord('movies', {
      issue: null,
      lineEnd: 2,
      lineStart: 2,
      row: movieRow({
        adult: 'talvez',
        belongs_to_collection: '[]',
        budget: '-1',
        genres: '{}',
        homepage: 'ftp://exemplo.test',
        imdb_id: 'imdb-invalido',
        original_language: 'pt-BR',
        original_title: '',
        popularity: 'NaN',
        production_companies: '{}',
        production_countries: '{}',
        release_date: '2024-02-30',
        revenue: '-1',
        runtime: '90.5',
        spoken_languages: '{}',
        title: '',
        video: 'talvez',
        vote_average: '11',
        vote_count: '-1',
      }),
    });

    assert.deepEqual(issues.map((issue) => issue.field), [
      'adult',
      'belongs_to_collection',
      'budget',
      'genres',
      'homepage',
      'imdb_id',
      'original_language',
      'popularity',
      'production_companies',
      'production_countries',
      'release_date',
      'revenue',
      'runtime',
      'spoken_languages',
      'video',
      'vote_average',
      'vote_count',
      'title',
    ]);
  });

  it('deve aceitar mais de uma URL http no campo homepage', () => {
    const issues = validateDatasetRecord('movies', {
      issue: null,
      lineEnd: 2,
      lineStart: 2,
      row: movieRow({ homepage: 'http://primeiro.example http://segundo.example' }),
    });

    assert.equal(issues.some((issue) => issue.field === 'homepage'), false);
  });

  it('deve aceitar idioma sem nome e rejeitar identificadores aninhados duplicados', () => {
    const movieIssues = validateDatasetRecord('movies', {
      issue: null,
      lineEnd: 2,
      lineStart: 2,
      row: movieRow({
        belongs_to_collection: '{invalido',
        genres: "[{'id': 18, 'name': 'Drama'}, {'id': 18, 'name': 'Drama alternativo'}]",
        spoken_languages: "[{'iso_639_1': 'en', 'name': ''}]",
      }),
    });
    const creditsIssues = validateDatasetRecord('credits', {
      issue: null,
      lineEnd: 2,
      lineStart: 2,
      row: {
        cast: "[{'credit_id': 'credit-1', 'id': 1, 'name': 'Pessoa', 'order': 0}, {'credit_id': 'credit-1', 'id': 2, 'name': 'Outra pessoa', 'order': 1}]",
        crew: '[]',
        id: '1',
      },
    });

    assert.deepEqual(movieIssues.map((issue) => issue.field), ['belongs_to_collection', 'genres[1].id']);
    assert.deepEqual(creditsIssues.map((issue) => issue.ruleCode), ['cast_credit_id_unique']);
  });
});

function movieRow(overrides: Partial<Record<string, string>>): Record<string, string> {
  return {
    adult: 'False',
    belongs_to_collection: '',
    budget: '0',
    genres: "[{'id': 18, 'name': 'Drama'}]",
    homepage: '',
    id: '1',
    imdb_id: '',
    original_language: 'pt',
    original_title: 'Título',
    overview: '',
    popularity: '0',
    poster_path: '',
    production_companies: '[]',
    production_countries: '[]',
    release_date: '2024-01-01',
    revenue: '0',
    runtime: '90',
    spoken_languages: '[]',
    status: 'Released',
    tagline: '',
    title: 'Título',
    video: 'False',
    vote_average: '0',
    vote_count: '0',
    ...overrides,
  };
}
