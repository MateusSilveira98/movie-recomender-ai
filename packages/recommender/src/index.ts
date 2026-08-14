import type { Movie } from '@pkg/shared/entities/models/movie.model';
import type { Preferences } from '@pkg/shared/entities/models/preferences.model';
import type { Recommendation } from '@pkg/shared/entities/models/recommendation.model';
import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';
import {
  createRecommendationRanker,
  type RecommendationRankerOptions,
} from './recommendations/application/services/recommendation-ranker.service.js';

export { createDatasetImportQueue, type DatasetImportQueue } from './workers/dataset/application/dataset-import-queue.service.js';
export { createSqlDatasetImportGateway } from './workers/dataset/infrastructure/dataset-import-queue.adapter.js';
export { createRabbitMqDatasetImportCommandPublisher } from './workers/dataset/infrastructure/messaging/rabbitmq-dataset-import-command.adapter.js';
export { createDatasetImportStatusStore } from './workers/dataset/infrastructure/storage/dataset-import-status.store.js';
export {
  DATASET_FILE_TYPES,
  type DatasetDiagnosticSummary,
  type DatasetDiagnosticsPage,
  type DatasetDiagnosticsPagination,
  type DatasetFileType,
  type DatasetImportDiagnostic,
  type DatasetImportJob,
  type DatasetUpload,
} from './workers/dataset/domain/dataset-import-queue.types.js';
export type { DatasetImportCommand } from './workers/dataset/domain/dataset-import-command.types.js';
export type { DatasetImportPipelineStage, DatasetImportPipelineStatus } from './workers/dataset/domain/dataset-import-status.types.js';
export { createRecommendationRanker, type RecommendationRanker, type RecommendationRankerOptions } from './recommendations/application/services/recommendation-ranker.service.js';
export { HYBRID_V1_RANKING_POLICY } from './recommendations/domain/consts/hybrid-v1-ranking-policy.const.js';
export type { RecommendationRanking } from './recommendations/domain/models/recommendation-ranking.model.js';
export type { RecommendationRankingPolicy } from './recommendations/domain/models/recommendation-ranking-policy.model.js';
export type { ModelScoreBatch, ModelScoreProvider } from './recommendations/domain/ports/model-score-provider.port.js';

export function rankRecommendations(
  catalog: readonly Movie[],
  preferences: Preferences,
  history: ViewerHistory,
  options: RecommendationRankerOptions = {},
) {
  return createRecommendationRanker(options).rank(catalog, preferences, history);
}

export function getRecommendations(catalog: readonly Movie[], preferences: Preferences, history: ViewerHistory): Recommendation[] {
  return rankRecommendations(catalog, preferences, history).recommendations;
}
