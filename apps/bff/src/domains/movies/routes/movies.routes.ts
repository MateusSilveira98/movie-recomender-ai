import express from 'express';
import { createListGenresController, createListMoviesController } from '../controllers/movies.controller.js';
import type { MovieCatalogRepository } from '../repositories/movies.repository.js';
import { createMoviesService } from '../services/movies.service.js';

export function createMoviesRoutes(movieCatalogRepository: MovieCatalogRepository): express.Router {
  const router = express.Router();
  const moviesService = createMoviesService(movieCatalogRepository);

  router.get('/movies', createListMoviesController(moviesService));
  router.get('/genres', createListGenresController(moviesService));

  return router;
}
