import type { Client } from '@libsql/client';
import { flushStatements } from '../sql-statement.writer.js';
import type { MovieFeatureDraft, SqlStatement } from '../../../domain/dataset.types.js';

export async function importMovieFeatures(client: Client, featureDrafts: Map<string, MovieFeatureDraft>): Promise<number> {
  const statements: SqlStatement[] = [];

  for (const draft of featureDrafts.values()) {
    statements.push([
      `INSERT INTO movie_features (movie_id, summary_text, genres_json, cast_json, crew_json, feature_vector_json, feature_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(movie_id) DO UPDATE SET summary_text = excluded.summary_text, genres_json = excluded.genres_json,
          cast_json = excluded.cast_json, crew_json = excluded.crew_json, feature_vector_json = excluded.feature_vector_json,
          feature_version = excluded.feature_version, updated_at = CURRENT_TIMESTAMP`,
      [draft.movieId, draft.summaryText, JSON.stringify(draft.genres), JSON.stringify(draft.cast), JSON.stringify(draft.crew), JSON.stringify([]), 'v1'],
    ]);

    if (statements.length >= 200) {
      await flushStatements(client, statements);
    }
  }

  await flushStatements(client, statements);
  return featureDrafts.size;
}
