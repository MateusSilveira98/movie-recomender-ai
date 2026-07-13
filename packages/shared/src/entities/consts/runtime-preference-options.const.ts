import type { RuntimePreference } from '../types/runtime-preference.type.js';

export const RUNTIME_PREFERENCE_OPTIONS: Array<{ value: RuntimePreference; label: string }> = [
  { value: 'any', label: 'Tanto faz' },
  { value: 'short', label: 'Curto' },
  { value: 'medium', label: 'Medio' },
  { value: 'long', label: 'Longo' },
];
