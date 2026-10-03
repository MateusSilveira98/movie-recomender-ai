export type ModelVersionStatus = 'candidate' | 'active' | 'failed' | 'archived';

export interface ModelVersion {
  activatedAt?: string;
  createdAt: string;
  failureReason?: string;
  manifestKey: string;
  sourceCommitSha?: string;
  status: ModelVersionStatus;
  version: string;
  workflowRunId?: string;
}

export interface RegisterModelVersionCandidateInput {
  createdAt: string;
  manifestKey: string;
  sourceCommitSha?: string;
  version: string;
  workflowRunId?: string;
}
