export interface Movie {
  id: string;
  title: string;
  year: number;
  genres: string[];
  runtime: number;
  adult: boolean;
  popularity: number;
  voteCount: number;
  description: string;
}
