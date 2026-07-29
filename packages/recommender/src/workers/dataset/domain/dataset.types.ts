export interface DatasetImportConfiguration {
  datasetKey: string;
  datasetVersion: string;
  environment: string;
  force: boolean;
}

export interface DatasetLinks {
  byMovieLensId: Map<number, LinkRecord>;
  byTmdbId: Map<number, LinkRecord>;
}

export interface DatasetPaths {
  creditsPath: string;
  linksPath: string;
  moviesMetadataPath: string;
  ratingsPath: string;
}

export interface LinkRecord {
  movieId: number;
  movieLensId: number;
}

export interface MovieFeatureDraft {
  cast: string[];
  crew: string[];
  genres: string[];
  movieId: string;
  summaryText: string;
}

export interface MovieImportResult {
  featureDrafts: Map<string, MovieFeatureDraft>;
  importedCount: number;
  knownMovieIds: Set<string>;
  processedCount: number;
  rejectedCount: number;
}

export interface MovieRatingStats {
  count: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  max: number;
  mean: number;
  min: number;
  movieId: string;
  movieLensId: number;
  m2: number;
  sum: number;
}

export type SqlArg = string | number | null;
export type SqlStatement = [string, SqlArg[]];
