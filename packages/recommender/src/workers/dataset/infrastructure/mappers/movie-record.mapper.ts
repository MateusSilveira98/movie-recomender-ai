import { parseLooseArray, parseLooseJson, parseNumber, parsePositiveInteger } from '../data/csv.reader.js';
import type { DatasetLinks } from '../../domain/dataset.types.js';

interface MovieCollection {
  backdrop_path: string | null;
  poster_path: string | null;
}

export interface MovieRecord {
  adult: number;
  backdropPath: string | null;
  belongsToCollectionJson: string;
  genres: GenreRecord[];
  homepage: string;
  id: string;
  imdbId: string | null;
  movieLensId: number | null;
  originalLanguage: string;
  originalTitle: string;
  overview: string;
  posterPath: string | null;
  popularity: number;
  releaseDate: string | null;
  releaseYear: number;
  runtimeMinutes: number;
  status: string;
  tagline: string;
  title: string;
  tmdbId: string;
  voteAverage: number;
  voteCount: number;
}

export interface GenreRecord {
  id: number;
  name: string;
  order: number;
}

export interface CastRecord {
  castOrder: number;
  characterName: string;
  creditId: string;
  gender: number;
  movieId: string;
  personId: number;
  personName: string;
  profilePath: string | null;
}

export interface CrewRecord {
  creditId: string;
  department: string;
  gender: number;
  job: string;
  movieId: string;
  personId: number;
  personName: string;
  profilePath: string | null;
}

export function toMovieRecord(row: Record<string, string>, links: DatasetLinks): MovieRecord | null {
  const tmdbId = row.id.trim();
  const tmdbIdNumber = parsePositiveInteger(tmdbId);
  const title = row.title.trim() || row.original_title.trim();

  if (tmdbId.length === 0 || tmdbIdNumber === null || tmdbIdNumber <= 0 || title.length === 0) {
    return null;
  }

  const normalizedTmdbId = String(tmdbIdNumber);
  const releaseDate = row.release_date.trim() || null;
  const collection = parseCollection(row.belongs_to_collection);
  const link = links.byTmdbId.get(tmdbIdNumber);
  const genres = parseLooseArray(row.genres)
    .map((genre, index) => toGenreRecord(genre, index))
    .filter((genre): genre is GenreRecord => genre !== null);

  return {
    adult: parseBoolean(row.adult),
    backdropPath: collection?.backdrop_path ?? null,
    belongsToCollectionJson: JSON.stringify(collection ?? {}),
    genres,
    homepage: row.homepage.trim(),
    id: normalizedTmdbId,
    imdbId: row.imdb_id.trim() || null,
    movieLensId: link?.movieLensId ?? null,
    originalLanguage: row.original_language.trim(),
    originalTitle: row.original_title.trim() || title,
    overview: row.overview.trim(),
    posterPath: row.poster_path.trim() || null,
    popularity: parseNumber(row.popularity),
    releaseDate,
    releaseYear: parseReleaseYear(releaseDate),
    runtimeMinutes: parsePositiveInteger(row.runtime) ?? 0,
    status: row.status.trim(),
    tagline: row.tagline.trim(),
    title,
    tmdbId: normalizedTmdbId,
    voteAverage: parseNumber(row.vote_average),
    voteCount: parsePositiveInteger(row.vote_count) ?? 0,
  };
}

export function toCastRecord(value: unknown, movieId: string, castOrder: number): CastRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const creditId = getTrimmedString(value.credit_id);
  const personId = parsePositiveInteger(String(value.id ?? ''));
  const personName = getTrimmedString(value.name);

  if (creditId.length === 0 || personId === null || personName.length === 0) {
    return null;
  }

  return {
    castOrder: parsePositiveInteger(String(value.order ?? '')) ?? castOrder,
    characterName: getTrimmedString(value.character),
    creditId,
    gender: parsePositiveInteger(String(value.gender ?? '')) ?? 0,
    movieId,
    personId,
    personName,
    profilePath: getNullableString(value.profile_path),
  };
}

export function toCrewRecord(value: unknown, movieId: string): CrewRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const creditId = getTrimmedString(value.credit_id);
  const personId = parsePositiveInteger(String(value.id ?? ''));
  const personName = getTrimmedString(value.name);
  const department = getTrimmedString(value.department);
  const job = getTrimmedString(value.job);

  if (creditId.length === 0 || personId === null || personName.length === 0 || department.length === 0 || job.length === 0) {
    return null;
  }

  return {
    creditId,
    department,
    gender: parsePositiveInteger(String(value.gender ?? '')) ?? 0,
    job,
    movieId,
    personId,
    personName,
    profilePath: getNullableString(value.profile_path),
  };
}

export function parseMovieId(value: string): string | null {
  const movieId = parsePositiveInteger(value.trim());

  return movieId === null || movieId <= 0 ? null : String(movieId);
}

export function normalizeMovieLensId(movie: MovieRecord, movieIdsByMovieLensId: Map<number, string>): void {
  if (movie.movieLensId === null) {
    return;
  }

  const existingMovieId = movieIdsByMovieLensId.get(movie.movieLensId);

  if (!existingMovieId || existingMovieId === movie.id) {
    movieIdsByMovieLensId.set(movie.movieLensId, movie.id);
    return;
  }

  movie.movieLensId = null;
}

export function normalizeImdbId(movie: MovieRecord, movieIdsByImdbId: Map<string, string>): void {
  if (!movie.imdbId) {
    return;
  }

  const existingMovieId = movieIdsByImdbId.get(movie.imdbId);

  if (!existingMovieId || existingMovieId === movie.id) {
    movieIdsByImdbId.set(movie.imdbId, movie.id);
    return;
  }

  movie.imdbId = null;
}

function parseCollection(value: string): MovieCollection | null {
  const parsed = parseLooseJson(value);

  if (!isRecord(parsed)) {
    return null;
  }

  return {
    backdrop_path: getNullableString(parsed.backdrop_path),
    poster_path: getNullableString(parsed.poster_path),
  };
}

function toGenreRecord(value: unknown, order: number): GenreRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = parsePositiveInteger(String(value.id ?? ''));
  const name = getTrimmedString(value.name);

  return id === null || name.length === 0 ? null : { id, name, order };
}

function parseBoolean(value: string): number {
  return value.trim().toLowerCase() === 'true' ? 1 : 0;
}

function parseReleaseYear(releaseDate: string | null): number {
  if (!releaseDate) {
    return 0;
  }

  const parsedYear = Number.parseInt(releaseDate.slice(0, 4), 10);

  return Number.isFinite(parsedYear) ? parsedYear : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getNullableString(value: unknown): string | null {
  const normalized = getTrimmedString(value);

  return normalized.length > 0 ? normalized : null;
}
