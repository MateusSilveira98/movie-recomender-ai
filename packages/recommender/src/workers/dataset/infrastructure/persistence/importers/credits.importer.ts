import type { Client } from '@libsql/client';
import { parseLooseArray, readCsv } from '../../data/csv.reader.js';
import { parseMovieId, toCastRecord, toCrewRecord } from '../../mappers/movie-record.mapper.js';
import { flushStatements } from '../sql-statement.writer.js';
import type { MovieFeatureDraft, SqlStatement } from '../../../domain/dataset.types.js';

const INDEXED_CREW_JOBS = new Set(['Director', 'Screenplay', 'Producer', 'Original Story', 'Original Music Composer']);

export async function importCredits(
  client: Client,
  filePath: string,
  knownMovieIds: Set<string>,
  featureDrafts: Map<string, MovieFeatureDraft>,
): Promise<CreditsImportResult> {
  const statements: SqlStatement[] = [];
  let importedRows = 0;
  let missingMovieRows = 0;
  let processedRows = 0;
  let rejectedRows = 0;

  for await (const row of readCsv(filePath)) {
    processedRows += 1;
    const movieId = parseMovieId(row.id);

    if (!movieId) {
      rejectedRows += 1;
      continue;
    }

    if (!knownMovieIds.has(movieId)) {
      missingMovieRows += 1;
      continue;
    }

    const featureDraft = featureDrafts.get(movieId) ?? createFeatureDraft(movieId);
    featureDrafts.set(movieId, featureDraft);

    parseLooseArray(row.cast).forEach((member, index) => {
      const castRecord = toCastRecord(member, movieId, index);

      if (!castRecord) {
        return;
      }

      statements.push(createCastStatement(castRecord));
      appendUnique(featureDraft.cast, castRecord.personName);
      importedRows += 1;
    });

    parseLooseArray(row.crew).forEach((member) => {
      const crewRecord = toCrewRecord(member, movieId);

      if (!crewRecord) {
        return;
      }

      statements.push(createCrewStatement(crewRecord));
      importedRows += 1;

      if (INDEXED_CREW_JOBS.has(crewRecord.job)) {
        appendUnique(featureDraft.crew, `${crewRecord.job}: ${crewRecord.personName}`);
      }
    });

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
