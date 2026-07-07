export type SessionFeedback = 'liked' | 'disliked' | 'watched_neutral' | 'blocked';

export interface SessionProfile {
  genres: string[];
  likedMovies: string[];
  dislikedMovies: string[];
}

export function createSessionProfile(profile: SessionProfile): SessionProfile {
  return profile;
}

export function getHealthMessage(source: string): string {
  return `${source} ready`;
}
