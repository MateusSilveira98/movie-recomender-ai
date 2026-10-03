import type { ModelVersionStatus } from '../models/model-version.model.js';

const ALLOWED_TRANSITIONS: Readonly<Record<ModelVersionStatus, readonly ModelVersionStatus[]>> = {
  active: ['archived'],
  archived: [],
  candidate: ['active', 'failed'],
  failed: [],
};

export function assertModelVersionTransition(from: ModelVersionStatus, to: ModelVersionStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Transição de versão inválida: ${from} -> ${to}.`);
  }
}
