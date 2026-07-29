import express from 'express';
import { createListGenresController, createListMoviesController } from '../controllers/movies.controller.js';
import { createInMemoryMovieCatalogRepository } from '../repositories/movies.repository.js';
import { createMoviesService } from '../services/movies.service.js';

export function createMoviesRoutes(): express.Router {
  const router = express.Router();
  const moviesService = createMoviesService(createInMemoryMovieCatalogRepository());

  router.get('/movies', createListMoviesController(moviesService));
  router.get('/genres', createListGenresController(moviesService));

  return router;
}
