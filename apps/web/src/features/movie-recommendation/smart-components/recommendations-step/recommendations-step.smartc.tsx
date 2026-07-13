import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, Card, CardContent, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import { RUNTIME_PREFERENCE_LABELS } from '@movie-recomender-ai/shared/entities/consts/runtime-preference-labels.const';
import { formatMinutes } from '@movie-recomender-ai/shared/data-access/services/ui-services/movie-format.ui.service';
import { useState } from 'react';
import { HistoryLine } from '../../dumb-components/history-line/history-line.dumbc';
import type { RecommendationResultTab } from '../../entities/types/recommendation-result-tab.type';
import type { RecommendationsStepProps } from './recommendations-step.interface';

const roundDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function RecommendationsStep({ recommendations, rounds, onStartNewRound }: RecommendationsStepProps) {
  const [activeTab, setActiveTab] = useState<RecommendationResultTab>('recommendations');

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: { xs: 'stretch', md: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Typography variant="h5">Recomendacoes pra sua rodada</Typography>
                <Typography color="text.secondary">
                  Na proxima visita, vc cai direto aqui. Use nova rodada pra trocar preferencias.
                </Typography>
              </Box>
              <Button startIcon={<RestartAltIcon />} variant="outlined" onClick={onStartNewRound}>
                Nova rodada
              </Button>
            </Stack>

            <Tabs
              value={activeTab}
              onChange={(_, value: RecommendationResultTab) => setActiveTab(value)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab label="Recomendacoes" value="recommendations" />
              <Tab label={`Historico (${rounds.length})`} value="rounds" />
            </Tabs>
          </Stack>
        </CardContent>
      </Card>

      {activeTab === 'recommendations' && <RecommendationsList recommendations={recommendations} />}
      {activeTab === 'rounds' && <RecommendationRoundsHistory rounds={rounds} />}
    </Stack>
  );
}

function RecommendationsList({ recommendations }: Pick<RecommendationsStepProps, 'recommendations'>) {
  return (
    <Stack spacing={2}>
      {recommendations.map((movie) => (
        <Card key={movie.id} variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                sx={{ alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography variant="h6">
                    {movie.title} ({movie.year})
                  </Typography>
                  <Typography color="text.secondary">{movie.description}</Typography>
                </Box>
                <Chip color="primary" label={`${Math.max(movie.score, 1) * 10}% match`} />
              </Stack>
              <Typography>{movie.reason}.</Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {movie.genres.map((genre) => (
                  <Chip key={genre} label={genre} size="small" variant="outlined" />
                ))}
                <Chip label={formatMinutes(movie.runtime)} size="small" variant="outlined" />
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function RecommendationRoundsHistory({ rounds }: Pick<RecommendationsStepProps, 'rounds'>) {
  if (rounds.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography color="text.secondary">Nenhuma rodada salva ainda.</Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      {rounds.map((round, index) => (
        <Card key={round.id} variant="outlined">
          <CardContent>
            <Stack spacing={3}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                sx={{ alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography variant="h6">Rodada {rounds.length - index}</Typography>
                  <Typography color="text.secondary">{formatRoundDate(round.createdAt)}</Typography>
                </Box>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {round.preferences.moods.map((mood) => (
                    <Chip key={mood} label={mood} size="small" />
                  ))}
                  <Chip label={RUNTIME_PREFERENCE_LABELS[round.preferences.runtime]} size="small" />
                </Stack>
              </Stack>

              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {round.preferences.genres.map((genre) => (
                  <Chip key={genre} label={genre} size="small" variant="outlined" />
                ))}
              </Stack>

              <Stack spacing={1}>
                <Typography variant="subtitle2">Recomendacoes</Typography>
                {round.recommendations.map((movie) => (
                  <Box key={movie.id}>
                    <Typography variant="body2">
                      {movie.title} ({movie.year})
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      {movie.reason}.
                    </Typography>
                  </Box>
                ))}
              </Stack>

              <Stack spacing={2}>
                <Typography variant="subtitle2">Sinais usados</Typography>
                <HistoryLine label="Visualizados" movieIds={round.history.watched} />
                <HistoryLine label="Gostei" movieIds={round.history.liked} />
                <HistoryLine label="Nao gostei" movieIds={round.history.disliked} />
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function formatRoundDate(createdAt: string): string {
  return roundDateFormatter.format(new Date(createdAt));
}
