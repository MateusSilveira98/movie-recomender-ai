import type { Preferences } from '@movie-recomender-ai/shared/entities/models/preferences.model';
import type { RequestStatus } from '../../entities/types/request-status.type';

export interface PreferencesStepProps {
  preferences: Preferences;
  genreOptions: string[];
  genreOptionsStatus: RequestStatus;
  onBack: () => void;
  onContinue: () => void;
  onGenreToggle: (genre: string) => void;
  onRetryGenres: () => void;
  onRuntimeChange: (runtime: Preferences['runtime']) => void;
}
