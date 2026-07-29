import type { Client } from '@libsql/client';
import { parsePositiveInteger, readCsv } from '../../data/csv.reader.js';

export interface LinksImportResult {
  importedRows: number;
  processedRows: number;
  rejectedRows: number;
}

export async function importLinks(client: Client, filePath: string): Promise<LinksImportResult> {
  let importedRows = 0;
  let processedRows = 0;
  let rejectedRows = 0;

  for await (const row of readCsv(filePath)) {
    processedRows += 1;
    const movieLensId = parsePositiveInteger(row.movieId);
    const tmdbId = parsePositiveInteger(row.tmdbId);

    if (movieLensId === null || tmdbId === null) {
      rejectedRows += 1;
      continue;
    }

    await client.batch([
      {
        sql: `INSERT INTO dataset_movie_links (movie_lens_id, tmdb_id, created_at, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(movie_lens_id) DO UPDATE SET tmdb_id = excluded.tmdb_id, updated_at = CURRENT_TIMESTAMP`,
        args: [movieLensId, String(tmdbId)],
      },
      {
        sql: `UPDATE OR IGNORE movies SET movie_lens_id = ?
          WHERE tmdb_id = ? AND (movie_lens_id IS NULL OR movie_lens_id = ?)`,
        args: [movieLensId, String(tmdbId), movieLensId],
      },
    ], 'write');
    importedRows += 1;
  }

  return { importedRows, processedRows, rejectedRows };
}
