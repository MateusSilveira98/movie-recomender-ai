import type { RequestHandler } from 'express';
import { createAsyncHandler } from '../../../middlewares/request-logger.middleware.js';
import type { MoviesService } from '../services/movies.service.js';
import { validateMovieQuery } from '../validators/movies.validator.js';

export function createListMoviesController(moviesService: MoviesService): RequestHandler {
  return createAsyncHandler(async (request, response) => {
    const validation = validateMovieQuery(request.query);

    if (!validation.valid) {
      response.status(400).json({ error: validation.error });
      return;
    }

    response.json({ movies: await moviesService.listByFilter(validation.data) });
  });
}

export function createListGenresController(moviesService: MoviesService): RequestHandler {
  return createAsyncHandler(async (_request, response) => {
    response.json({ genres: await moviesService.listGenres() });
  });
}
