import type { RecommendationStepId } from '../types/recommendation-step-id.type';

export const STEPS: Array<{ id: RecommendationStepId; label: string }> = [
  { id: 'intro', label: 'Inicio' },
  { id: 'preferences', label: 'Preferencias' },
  { id: 'watched', label: 'Assistidos' },
  { id: 'liked', label: 'Avaliacao' },
  { id: 'recommendations', label: 'Recomendacoes' },
];
