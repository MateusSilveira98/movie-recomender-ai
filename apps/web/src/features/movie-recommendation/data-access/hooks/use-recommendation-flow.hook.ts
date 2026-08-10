import { useEffect, useMemo, useRef, useState } from 'react';
import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { RecommendationRound as StoredRecommendationRound } from '@pkg/shared/entities/models/recommendation-round.model';
import type { Session } from '@pkg/shared/entities/models/session.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import type { RuntimePreference } from '@pkg/shared/entities/types/runtime-preference.type';
import { DEFAULT_HISTORY, DEFAULT_PREFERENCES } from '../../entities/consts/defaults.const';
import type { RecommendationStepId } from '../../entities/types/recommendation-step-id.type';
import type { RequestStatus } from '../../entities/types/request-status.type';
import {
  createRecommendationSession,
  fetchCurrentSession,
  fetchGenreOptions,
  fetchMovieCatalog,
  type SessionRecommendation,
  sendSessionFeedback,
} from '../services/api-services/recommendation-api.service';
import type { RecommendationRound } from '../services/ui-services/movie-session.ui.service';
import { toggleItem } from '../../../../shared/data-access/services/ui-services/selection.ui.service';

const MOVIE_CANDIDATE_LIMIT = 10;
const LEGACY_SESSION_STORAGE_KEY = 'movie-recommender-ai-session';

export function useRecommendationFlow() {
  const didRestoreCurrentSession = useRef(false);
  const [activeStep, setActiveStep] = useState<RecommendationStepId>('intro');
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [history, setHistory] = useState<ViewerHistory>(DEFAULT_HISTORY);
  const [recommendationRounds, setRecommendationRounds] = useState<RecommendationRound[]>([]);
  const [hasStoredSession, setHasStoredSession] = useState(false);

  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [genreOptionsStatus, setGenreOptionsStatus] = useState<RequestStatus>('idle');

  const [movies, setMovies] = useState<Movie[]>([]);
  const [moviesStatus, setMoviesStatus] = useState<RequestStatus>('idle');

  const [recommendations, setRecommendations] = useState<SessionRecommendation[]>([]);
  const [recommendationsStatus, setRecommendationsStatus] = useState<RequestStatus>('idle');
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);

  useEffect(() => {
    if (didRestoreCurrentSession.current) {
      return;
    }

    didRestoreCurrentSession.current = true;
    window.localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    loadGenreOptions();
    void restoreCurrentSession();
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

  async function restoreCurrentSession() {
    try {
      const currentSession = await fetchCurrentSession();

      applyProfile(currentSession.profile);
      setRecommendationRounds(currentSession.rounds.map(toRecommendationRound));

      if (!currentSession.session) {
        return;
      }

      applySession(currentSession.session, currentSession.recommendations);
      setHasStoredSession(true);
      setActiveStep('recommendations');
    } catch {
      // A primeira visita continua utilizável mesmo quando a restauração falha.
    }
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
    setRecommendations([]);
    setRecommendationsStatus('idle');
    setRecommendationsError(null);
    setHasStoredSession(false);
    setActiveStep('preferences');
  }

  async function completeRound() {
    setRecommendationsStatus('loading');
    setRecommendationsError(null);

    try {
      const currentSession = await createRecommendationSession({ preferences, history });
      const session = currentSession.session;

      if (!session) {
        throw new Error('Nao foi possivel iniciar uma nova rodada.');
      }

      applySession(session, currentSession.recommendations);
      setRecommendationRounds((rounds) => [
        buildRecommendationRound(session, currentSession.recommendations, movies),
        ...rounds,
      ]);
      setHasStoredSession(true);
      setActiveStep('recommendations');
    } catch (error) {
      setRecommendationsStatus('error');
      setRecommendationsError(resolveErrorMessage(error));
    }
  }

  async function setRecommendationFeedback(impressionId: string, opinion: 'liked' | 'disliked') {
    setRecommendationsStatus('loading');
    setRecommendationsError(null);

    try {
      const currentSession = await sendSessionFeedback({ impressionId, feedback: opinion });

      applySession(currentSession.session, currentSession.recommendations);
      updateActiveRound(currentSession.session, currentSession.recommendations);
    } catch (error) {
      setRecommendationsStatus('error');
      setRecommendationsError(resolveErrorMessage(error));
    }
  }

  function applySession(session: Session, nextRecommendations: SessionRecommendation[]) {
    applyProfile(session);
    setRecommendations(nextRecommendations);
    setRecommendationsStatus('success');
  }

  function applyProfile(profile: Pick<Session, 'preferences' | 'history'>) {
    setPreferences(profile.preferences);
    setHistory(profile.history);
  }

  function updateActiveRound(session: Session, nextRecommendations: SessionRecommendation[]) {
    setRecommendationRounds((rounds) => {
      const [activeRound, ...otherRounds] = rounds;
      const updatedRound = buildRecommendationRound(session, nextRecommendations, movies);

      if (!activeRound) {
        return [updatedRound];
      }

      return [
        {
          ...activeRound,
          history: updatedRound.history,
          movieTitles: { ...activeRound.movieTitles, ...updatedRound.movieTitles },
          preferences: updatedRound.preferences,
          recommendations: [
            ...activeRound.recommendations,
            ...nextRecommendations.filter((recommendation) => !activeRound.recommendations.some((current) => current.id === recommendation.id)),
          ],
        },
        ...otherRounds,
      ];
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

function buildRecommendationRound(
  session: Session,
  recommendations: SessionRecommendation[],
  movies: Movie[],
): RecommendationRound {
  return toRecommendationRound({
    createdAt: session.createdAt,
    history: session.history,
    movieTitles: Object.fromEntries(
      [...movies, ...recommendations].map((movie) => [movie.id, movie.title]).filter(([, title]) => title.length > 0),
    ),
    preferences: session.preferences,
    recommendations,
  });
}

function toRecommendationRound(round: StoredRecommendationRound): RecommendationRound {
  return {
    id: `round-${round.createdAt}`,
    createdAt: round.createdAt,
    preferences: clonePreferences(round.preferences),
    history: cloneHistory(round.history),
    movieTitles: { ...(round.movieTitles ?? {}) },
    recommendations: round.recommendations.map(cloneRecommendation),
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
