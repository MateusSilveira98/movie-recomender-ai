import { useEffect, useMemo, useState } from 'react';
import type { Preferences } from '@movie-recomender-ai/shared/entities/models/preferences.model';
import type { Recommendation } from '@movie-recomender-ai/shared/entities/models/recommendation.model';
import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';
import type { Mood } from '@movie-recomender-ai/shared/entities/types/mood.type';
import type { RuntimePreference } from '@movie-recomender-ai/shared/entities/types/runtime-preference.type';
import { DEFAULT_HISTORY, DEFAULT_PREFERENCES } from '../../entities/consts/defaults.const';
import type { RecommendationStepId } from '../../entities/types/recommendation-step-id.type';
import { MOVIE_CATALOG_MOCK } from '@movie-recomender-ai/shared/mocks/movie';
import type { RecommendationRound } from '../services/ui-services/movie-session.ui.service';
import { getRecommendations } from '../services/ui-services/recommendation-engine.ui.service';
import { saveStoredSession, loadStoredSession } from '../services/ui-services/session-storage.ui.service';
import { toggleItem } from '../../../../shared/data-access/services/ui-services/selection.ui.service';

export function useRecommendationFlow() {
  const [activeStep, setActiveStep] = useState<RecommendationStepId>('intro');
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [history, setHistory] = useState<ViewerHistory>(DEFAULT_HISTORY);
  const [recommendationRounds, setRecommendationRounds] = useState<RecommendationRound[]>([]);
  const [hasStoredSession, setHasStoredSession] = useState(false);

  useEffect(() => {
    const storedSession = loadStoredSession();

    if (storedSession) {
      const storedRounds =
        storedSession.rounds.length > 0
          ? storedSession.rounds
          : [buildRecommendationRound(storedSession.preferences, storedSession.history)];

      setPreferences(storedSession.preferences);
      setHistory(storedSession.history);
      setRecommendationRounds(storedRounds);
      setHasStoredSession(true);
      setActiveStep('recommendations');
      saveStoredSession({ ...storedSession, rounds: storedRounds });
    }
  }, []);

  const watchedMovies = useMemo(
    () => MOVIE_CATALOG_MOCK.filter((movie) => history.watched.includes(movie.id)),
    [history.watched],
  );
  const recommendations = useMemo(() => getRecommendations(preferences, history), [history, preferences]);

  function startNewRound() {
    setPreferences(DEFAULT_PREFERENCES);
    setHistory(DEFAULT_HISTORY);
    setActiveStep('preferences');
  }

  function completeRound() {
    const nextRound = buildRecommendationRound(preferences, history);
    const nextRounds = [nextRound, ...recommendationRounds];

    setRecommendationRounds(nextRounds);
    saveStoredSession({
      preferences: nextRound.preferences,
      history: nextRound.history,
      rounds: nextRounds,
    });
    setHasStoredSession(true);
    setActiveStep('recommendations');
  }

  function updateGenres(genre: string) {
    setPreferences((current) => ({
      ...current,
      genres: toggleItem(current.genres, genre),
    }));
  }

  function updateMoods(mood: Mood) {
    setPreferences((current) => ({
      ...current,
      moods: toggleItem(current.moods, mood),
    }));
  }

  function updateRuntime(runtime: RuntimePreference) {
    setPreferences((current) => ({ ...current, runtime }));
  }

  function updateFreeText(freeText: string) {
    setPreferences((current) => ({ ...current, freeText }));
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
    watchedMovies,
    recommendations,
    recommendationRounds,
    startNewRound,
    completeRound,
    updateGenres,
    updateMoods,
    updateRuntime,
    updateFreeText,
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

function buildRecommendationRound(preferences: Preferences, history: ViewerHistory): RecommendationRound {
  const recommendations = getRecommendations(preferences, history);

  return {
    id: `round-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    preferences: clonePreferences(preferences),
    history: cloneHistory(history),
    recommendations: recommendations.map(cloneRecommendation),
  };
}

function clonePreferences(preferences: Preferences): Preferences {
  return {
    ...preferences,
    genres: [...preferences.genres],
    moods: [...preferences.moods],
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
