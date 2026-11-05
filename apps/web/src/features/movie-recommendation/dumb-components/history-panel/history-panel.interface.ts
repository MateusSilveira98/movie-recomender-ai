import type { ViewerHistory } from '@pkg/shared/entities/models/viewer-history.model';

export interface HistoryPanelProps {
  history: ViewerHistory;
  movieTitles?: Record<string, string>;
}
