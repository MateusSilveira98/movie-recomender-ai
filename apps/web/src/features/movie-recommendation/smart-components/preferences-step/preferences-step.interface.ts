import type { Preferences } from '@movie-recomender-ai/shared/entities/models/preferences.model';

export interface PreferencesStepProps {
  preferences: Preferences;
  onBack: () => void;
  onContinue: () => void;
  onFreeTextChange: (freeText: string) => void;
  onGenreToggle: (genre: string) => void;
  onMoodToggle: (mood: Preferences['moods'][number]) => void;
  onRuntimeChange: (runtime: Preferences['runtime']) => void;
}
