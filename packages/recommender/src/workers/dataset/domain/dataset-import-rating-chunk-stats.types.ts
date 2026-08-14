export interface DatasetImportRatingChunkStats {
  chunkId: string;
  firstRatingAt: string | null;
  lastRatingAt: string | null;
  movieId: string;
  movieLensId: number;
  ratingCount: number;
  ratingM2: number;
  ratingMax: number;
  ratingMean: number;
  ratingMin: number;
  ratingSum: number;
}
