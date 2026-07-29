import type { RequestHandler } from 'express';
import type { MoviesService } from '../services/movies.service.js';
import { validateMovieQuery } from '../validators/movies.validator.js';

export function createListMoviesController(moviesService: MoviesService): RequestHandler {
  return (request, response) => {
    const validation = validateMovieQuery(request.query);

    if (!validation.valid) {
      response.status(400).json({ error: validation.error });
      return;
    }

    response.json({ movies: moviesService.listByFilter(validation.data) });
  };
}

export function createListGenresController(moviesService: MoviesService): RequestHandler {
  return (_request, response) => {
    response.json({ genres: moviesService.listGenres() });
  };
}
