import { RecommendationPage } from '../features/movie-recommendation';
import { AppProviders } from './providers/app-providers';

export function App() {
  return (
    <AppProviders>
      <RecommendationPage />
    </AppProviders>
  );
}
