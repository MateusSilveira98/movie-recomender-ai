import { useEffect, useMemo, useState } from 'react';
import type { Movie } from '@movie-recomender-ai/shared/entities/models/movie.model';
import type { Preferences } from '@movie-recomender-ai/shared/entities/models/preferences.model';
import type { Recommendation } from '@movie-recomender-ai/shared/entities/models/recommendation.model';
import type { Session } from '@movie-recomender-ai/shared/entities/models/session.model';
import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';
import type { RuntimePreference } from '@movie-recomender-ai/shared/entities/types/runtime-preference.type';
import { DEFAULT_HISTORY, DEFAULT_PREFERENCES } from '../../entities/consts/defaults.const';
import type { RecommendationStepId } from '../../entities/types/recommendation-step-id.type';
import type { RequestStatus } from '../../entities/types/request-status.type';
import {
  createRecommendationSession,
  fetchGenreOptions,
  fetchMovieCatalog,
  fetchSessionRecommendations,
  sendSessionFeedback,
} from '../services/api-services/recommendation-api.service';
import type { RecommendationRound } from '../services/ui-services/movie-session.ui.service';
import { saveStoredSession, loadStoredSession } from '../services/ui-services/session-storage.ui.service';
import { toggleItem } from '../../../../shared/data-access/services/ui-services/selection.ui.service';

const MOVIE_CANDIDATE_LIMIT = 10;

export function useRecommendationFlow() {
  const [activeStep, setActiveStep] = useState<RecommendationStepId>('intro');
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [history, setHistory] = useState<ViewerHistory>(DEFAULT_HISTORY);
  const [recommendationRounds, setRecommendationRounds] = useState<RecommendationRound[]>([]);
  const [hasStoredSession, setHasStoredSession] = useState(false);

  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [genreOptionsStatus, setGenreOptionsStatus] = useState<RequestStatus>('idle');

  const [movies, setMovies] = useState<Movie[]>([]);
  const [moviesStatus, setMoviesStatus] = useState<RequestStatus>('idle');

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recommendationsStatus, setRecommendationsStatus] = useState<RequestStatus>('idle');
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);

  useEffect(() => {
    loadGenreOptions();
  }, []);

  useEffect(() => {
    const storedSession = loadStoredSession();

    if (!storedSession) {
      return;
    }

    const activeRound = storedSession.rounds[0] ?? null;

    setPreferences(storedSession.preferences);
    setHistory(storedSession.history);
    setRecommendationRounds(storedSession.rounds);
    setSessionId(activeRound?.sessionId ?? null);
    setRecommendations(activeRound?.recommendations ?? []);
    setRecommendationsStatus(activeRound ? 'success' : 'idle');
    setHasStoredSession(true);
    setActiveStep('recommendations');
  }, []);

  const watchedMovies = useMemo(
    () => movies.filter((movie) => history.watched.includes(movie.id)),
    [history.watched, movies],
  );

  function loadGenreOptions() {
    setGenreOptionsStatus('loading');

    fetchGenreOptions()
      .then((genres) => {
        setGenreOptions(genres);
        setGenreOptionsStatus('success');
      })
      .catch(() => {
        setGenreOptionsStatus('error');
      });
  }

  function loadMovies(filter: { genres: string[]; runtime: RuntimePreference; limit: number }) {
    setMoviesStatus('loading');

    fetchMovieCatalog(filter)
      .then((catalog) => {
        setMovies(catalog);
        setMoviesStatus('success');
      })
      .catch(() => {
        setMoviesStatus('error');
      });
  }

  function advanceToWatchedStep() {
    loadMovies({ genres: preferences.genres, runtime: preferences.runtime, limit: MOVIE_CANDIDATE_LIMIT });
    setActiveStep('watched');
  }

  function retryMovies() {
    loadMovies({ genres: preferences.genres, runtime: preferences.runtime, limit: MOVIE_CANDIDATE_LIMIT });
  }

  function startNewRound() {
    setPreferences(DEFAULT_PREFERENCES);
    setHistory(DEFAULT_HISTORY);
    setSessionId(null);
    setRecommendations([]);
    setRecommendationsStatus('idle');
    setRecommendationsError(null);
    setActiveStep('preferences');
  }

  async function completeRound() {
    setRecommendationsStatus('loading');
    setRecommendationsError(null);

    try {
      const session = await createRecommendationSession({ preferences, history });
      const fetchedRecommendations = await fetchSessionRecommendations(session.id);
      const nextRound = buildRecommendationRound(session, fetchedRecommendations);
      const nextRounds = [nextRound, ...recommendationRounds];

      setSessionId(session.id);
      setRecommendations(fetchedRecommendations);
      setRecommendationRounds(nextRounds);
      setRecommendationsStatus('success');
      setHasStoredSession(true);
      setActiveStep('recommendations');
      saveStoredSession({ preferences: nextRound.preferences, history: nextRound.history, rounds: nextRounds });
    } catch (error) {
      setRecommendationsStatus('error');
      setRecommendationsError(resolveErrorMessage(error));
    }
  }

  async function setRecommendationFeedback(movieId: string, opinion: 'liked' | 'disliked') {
    if (!sessionId) {
      return;
    }

    setRecommendationsStatus('loading');
    setRecommendationsError(null);

    try {
      const session = await sendSessionFeedback(sessionId, { movieId, feedback: opinion });
      const fetchedRecommendations = await fetchSessionRecommendations(sessionId);

      setHistory(session.history);
      setRecommendations(fetchedRecommendations);
      setRecommendationsStatus('success');
      updateActiveRound(session, fetchedRecommendations);
    } catch (error) {
      setRecommendationsStatus('error');
      setRecommendationsError(resolveErrorMessage(error));
    }
  }

  function updateActiveRound(session: Session, fetchedRecommendations: Recommendation[]) {
    setRecommendationRounds((currentRounds) => {
      const [activeRound, ...otherRounds] = currentRounds;

      if (!activeRound) {
        return currentRounds;
      }

      const updatedRound: RecommendationRound = {
        ...activeRound,
        history: cloneHistory(session.history),
        recommendations: fetchedRecommendations,
      };
      const nextRounds = [updatedRound, ...otherRounds];

      saveStoredSession({ preferences: updatedRound.preferences, history: updatedRound.history, rounds: nextRounds });

      return nextRounds;
    });
  }

  function updateGenres(genre: string) {
    setPreferences((current) => ({
      ...current,
      genres: toggleItem(current.genres, genre),
    }));
  }

  function updateRuntime(runtime: RuntimePreference) {
    setPreferences((current) => ({ ...current, runtime }));
  }

  function updateWatched(movieId: string) {
    setHistory((current) => {
      const watched = toggleItem(current.watched, movieId);

      return {
        watched,
        liked: current.liked.filter((likedMovieId) => watched.includes(likedMovieId)),
        disliked: current.disliked.filter((dislikedMovieId) => watched.includes(dislikedMovieId)),
      };
    });
  }

  function setMovieOpinion(movieId: string, opinion: 'liked' | 'disliked') {
    setHistory((current) => ({
      ...current,
      liked: updateOpinionList(current.liked, movieId, opinion === 'liked'),
      disliked: updateOpinionList(current.disliked, movieId, opinion === 'disliked'),
    }));
  }

  return {
    activeStep,
    setActiveStep,
    preferences,
    history,
    hasStoredSession,
    genreOptions,
    genreOptionsStatus,
    movies,
    moviesStatus,
    watchedMovies,
    recommendations,
    recommendationsStatus,
    recommendationsError,
    recommendationRounds,
    startNewRound,
    advanceToWatchedStep,
    completeRound,
    setRecommendationFeedback,
    retryGenreOptions: loadGenreOptions,
    retryMovies,
    updateGenres,
    updateRuntime,
    updateWatched,
    setMovieOpinion,
  };
}

function updateOpinionList(movieIds: string[], movieId: string, shouldInclude: boolean): string[] {
  if (!shouldInclude) {
    return movieIds.filter((currentMovieId) => currentMovieId !== movieId);
  }

  return Array.from(new Set([...movieIds, movieId]));
}

function buildRecommendationRound(session: Session, recommendations: Recommendation[]): RecommendationRound {
  return {
    id: `round-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: session.createdAt,
    sessionId: session.id,
    preferences: clonePreferences(session.preferences),
    history: cloneHistory(session.history),
    recommendations: recommendations.map(cloneRecommendation),
  };
}

function clonePreferences(preferences: Preferences): Preferences {
  return {
    ...preferences,
    genres: [...preferences.genres],
  };
}

function cloneHistory(history: ViewerHistory): ViewerHistory {
  return {
    watched: [...history.watched],
    liked: [...history.liked],
    disliked: [...history.disliked],
  };
}

function cloneRecommendation(recommendation: Recommendation): Recommendation {
  return {
    ...recommendation,
    genres: [...recommendation.genres],
  };
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Nao foi possivel completar a operacao.';
}
