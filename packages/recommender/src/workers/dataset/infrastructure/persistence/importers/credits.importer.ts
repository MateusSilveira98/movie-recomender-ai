import type { Client } from '@libsql/client';
import { parseLooseArray, readCsvRecords } from '../../data/csv.reader.js';
import { parseMovieId, toCastRecord, toCrewRecord } from '../../mappers/movie-record.mapper.js';
import { createDatasetDiagnostic, validateDatasetRecord } from '../../validation/dataset-csv.validator.js';
import type { DatasetImportDiagnosticsCollector } from '../dataset-import-diagnostics.repository.js';
import { flushStatements } from '../sql-statement.writer.js';
import type { MovieFeatureDraft, SqlStatement } from '../../../domain/dataset.types.js';

const INDEXED_CREW_JOBS = new Set(['Director', 'Screenplay', 'Producer', 'Original Story', 'Original Music Composer']);

export async function importCredits(
  client: Client,
  filePath: string,
  knownMovieIds: Set<string>,
  featureDrafts: Map<string, MovieFeatureDraft>,
  diagnostics: DatasetImportDiagnosticsCollector,
): Promise<CreditsImportResult> {
  const statements: SqlStatement[] = [];
  const seenMovieIds = new Set<string>();
  let importedRows = 0;
  let missingMovieRows = 0;
  let processedRows = 0;
  let rejectedRows = 0;

  for await (const record of readCsvRecords(filePath)) {
    processedRows += 1;
    const validationIssues = validateDatasetRecord('credits', record);

    if (validationIssues.length > 0) {
      await recordDiagnostics(diagnostics, validationIssues);
      rejectedRows += 1;
      continue;
    }

    const movieId = parseMovieId(record.row.id);

    if (!movieId) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'validation',
        field: 'id',
        message: 'Nao foi possivel normalizar o identificador do filme.',
        reason: 'invalid_field',
        ruleCode: 'movie_id_normalization',
        value: record.row.id ?? null,
      }));
      rejectedRows += 1;
      continue;
    }

    if (!knownMovieIds.has(movieId)) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'reference',
        field: 'id',
        message: 'O filme referenciado nao foi encontrado.',
        reason: 'movie_not_found',
        ruleCode: 'movie_reference',
        value: record.row.id ?? null,
      }));
      missingMovieRows += 1;
      continue;
    }

    if (seenMovieIds.has(movieId)) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'integrity',
        field: 'id',
        message: 'O filme possui mais de uma linha de creditos no arquivo.',
        reason: 'duplicate_value',
        ruleCode: 'duplicate_movie_credits',
        value: record.row.id ?? null,
      }));
      rejectedRows += 1;
      continue;
    }

    const parsedCastRecords = parseLooseArray(record.row.cast).map((member, index) => toCastRecord(member, movieId, index));
    const parsedCrewRecords = parseLooseArray(record.row.crew).map((member) => toCrewRecord(member, movieId));

    if (parsedCastRecords.some((member) => member === null) || parsedCrewRecords.some((member) => member === null)) {
      await diagnostics.record(createDatasetDiagnostic(record, {
        category: 'validation',
        field: 'cast',
        message: 'Nao foi possivel normalizar todos os creditos do filme.',
        reason: 'invalid_field',
        ruleCode: 'credit_normalization',
        value: null,
      }));
      rejectedRows += 1;
      continue;
    }

    const castRecords = parsedCastRecords.filter((member): member is NonNullable<ReturnType<typeof toCastRecord>> => member !== null);
    const crewRecords = parsedCrewRecords.filter((member): member is NonNullable<ReturnType<typeof toCrewRecord>> => member !== null);

    seenMovieIds.add(movieId);
    const featureDraft = featureDrafts.get(movieId) ?? createFeatureDraft(movieId);
    featureDrafts.set(movieId, featureDraft);
    statements.push(['DELETE FROM movie_cast WHERE movie_id = ?', [movieId]]);
    statements.push(['DELETE FROM movie_crew WHERE movie_id = ?', [movieId]]);

    castRecords.forEach((castRecord) => {
      statements.push(createCastStatement(castRecord));
      appendUnique(featureDraft.cast, castRecord.personName);
    });

    crewRecords.forEach((crewRecord) => {
      statements.push(createCrewStatement(crewRecord));

      if (INDEXED_CREW_JOBS.has(crewRecord.job)) {
        appendUnique(featureDraft.crew, `${crewRecord.job}: ${crewRecord.personName}`);
      }
    });

    importedRows += 1;

    if (statements.length >= 200) {
      await flushStatements(client, statements);
    }
  }

  await flushStatements(client, statements);
  return { importedRows, missingMovieRows, processedRows, rejectedRows };
}

export async function updateMovieFeaturePeople(client: Client, featureDrafts: Map<string, MovieFeatureDraft>): Promise<void> {
  const statements: SqlStatement[] = [];

  for (const draft of featureDrafts.values()) {
    statements.push([
      `UPDATE movie_features SET cast_json = ?, crew_json = ?, updated_at = CURRENT_TIMESTAMP WHERE movie_id = ?`,
      [JSON.stringify(draft.cast), JSON.stringify(draft.crew), draft.movieId],
    ]);

    if (statements.length >= 200) {
      await flushStatements(client, statements);
    }
  }

  await flushStatements(client, statements);
}

export interface CreditsImportResult {
  importedRows: number;
  missingMovieRows: number;
  processedRows: number;
  rejectedRows: number;
}

function createCastStatement(record: NonNullable<ReturnType<typeof toCastRecord>>): SqlStatement {
  return [
    `INSERT INTO movie_cast (movie_id, credit_id, cast_order, person_id, person_name, character_name, gender, profile_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(movie_id, credit_id) DO UPDATE SET cast_order = excluded.cast_order, person_id = excluded.person_id,
        person_name = excluded.person_name, character_name = excluded.character_name, gender = excluded.gender, profile_path = excluded.profile_path`,
    [record.movieId, record.creditId, record.castOrder, record.personId, record.personName, record.characterName, record.gender, record.profilePath],
  ];
}

function createCrewStatement(record: NonNullable<ReturnType<typeof toCrewRecord>>): SqlStatement {
  return [
    `INSERT INTO movie_crew (movie_id, credit_id, person_id, person_name, department, job, gender, profile_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(movie_id, credit_id) DO UPDATE SET person_id = excluded.person_id, person_name = excluded.person_name,
        department = excluded.department, job = excluded.job, gender = excluded.gender, profile_path = excluded.profile_path`,
    [record.movieId, record.creditId, record.personId, record.personName, record.department, record.job, record.gender, record.profilePath],
  ];
}

function appendUnique(values: string[] | undefined, value: string): void {
  if (!values || values.length >= 8 || value.length === 0 || values.includes(value)) {
    return;
  }

  values.push(value);
}

function createFeatureDraft(movieId: string): MovieFeatureDraft {
  return { cast: [], crew: [], genres: [], movieId, summaryText: '' };
}

async function recordDiagnostics(diagnostics: DatasetImportDiagnosticsCollector, issues: Parameters<DatasetImportDiagnosticsCollector['record']>[0][]): Promise<void> {
  for (const issue of issues) {
    await diagnostics.record(issue);
  }
}
