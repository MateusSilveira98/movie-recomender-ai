import type { ModelVersion, RegisterModelVersionCandidateInput } from '../../domain/models/model-version.model.js';

export interface ModelVersionRepository {
  findActive(): Promise<ModelVersion | undefined>;
  findByVersion(version: string): Promise<ModelVersion | undefined>;
  markFailed(version: string, failureReason: string): Promise<void>;
  promote(version: string, activatedAt: string): Promise<void>;
  registerCandidate(input: RegisterModelVersionCandidateInput): Promise<ModelVersion>;
}
