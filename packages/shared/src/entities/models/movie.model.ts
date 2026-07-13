import type { Mood } from '../types/mood.type.js';

export interface Movie {
  id: string;
  title: string;
  year: number;
  genres: string[];
  mood: Mood;
  runtime: number;
  description: string;
}
