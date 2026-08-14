import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import { HYBRID_V1_RANKING_POLICY } from '../../domain/consts/hybrid-v1-ranking-policy.const.js';
import type { RecommendationRanking } from '../../domain/models/recommendation-ranking.model.js';
import type { RecommendationRankingPolicy } from '../../domain/models/recommendation-ranking-policy.model.js';
import type { ModelScoreBatch, ModelScoreProvider } from '../../domain/ports/model-score-provider.port.js';
import { buildRankedRecommendations, getEligibleMovies } from '../../domain/services/recommendation-ranking.policy.js';

export interface RecommendationRanker {
  rank(catalog: readonly Movie[], preferences: Preferences, history: ViewerHistory): RecommendationRanking;
}

export interface RecommendationRankerOptions {
  modelScoreProvider?: ModelScoreProvider;
  policy?: RecommendationRankingPolicy;
}

export function createRecommendationRanker(options: RecommendationRankerOptions = {}): RecommendationRanker {
  const policy = options.policy ?? HYBRID_V1_RANKING_POLICY;

  return {
    rank(catalog, preferences, history) {
      const candidates = getEligibleMovies(catalog, history);
      const modelScoreBatch = resolveModelScores(candidates, options.modelScoreProvider);

      return {
        candidateCount: candidates.length,
        modelVersion: modelScoreBatch.modelVersion,
        rankingVersion: policy.version,
        recommendations: buildRankedRecommendations(candidates, catalog, preferences, history, modelScoreBatch.scores, policy),
      };
    },
  };
}

function resolveModelScores(candidates: readonly Movie[], provider: ModelScoreProvider | undefined): ResolvedModelScores {
  if (!provider || candidates.length === 0) {
    return emptyModelScores();
  }

  try {
    const batch: unknown = provider.getScores(candidates);

    if (!isModelScoreBatch(batch)) {
      return emptyModelScores();
    }

    const scores = new Map<string, number>();

    for (const movie of candidates) {
      const score = batch.scores.get(movie.id);

      if (score === undefined) {
        continue;
      }

      if (!Number.isFinite(score) || score < 0 || score > 1) {
        return emptyModelScores();
      }

      scores.set(movie.id, score);
    }

    return scores.size > 0 ? { modelVersion: normalizeModelVersion(batch.modelVersion), scores } : emptyModelScores();
  } catch {
    return emptyModelScores();
  }
}

function isModelScoreBatch(value: unknown): value is ModelScoreBatch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const scores = (value as { scores?: unknown }).scores;

  return typeof scores === 'object' && scores !== null && 'get' in scores && typeof (scores as { get?: unknown }).get === 'function';
}

function emptyModelScores(): ResolvedModelScores {
  return { scores: new Map() };
}

function normalizeModelVersion(modelVersion: string | undefined): string | undefined {
  const normalized = modelVersion?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}

interface ResolvedModelScores {
  modelVersion?: string;
  scores: ReadonlyMap<string, number>;
}
