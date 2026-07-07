import type { SessionProfile } from '../../shared/src/index.js';

export interface Recommendation {
  title: string;
  score: number;
  reason: string;
}

export function getDemoRecommendations(profile: SessionProfile): Recommendation[] {
  const primaryGenre = profile.genres[0] ?? 'Cinema';

  return [
    {
      title: 'Minority Report',
      score: 0.92,
      reason: `Combina com ${primaryGenre} e com os filmes marcados como gostei.`,
    },
    {
      title: 'Ex Machina',
      score: 0.88,
      reason: 'Boa opcao para uma sessao curta, tensa e focada em tecnologia.',
    },
  ];
}
