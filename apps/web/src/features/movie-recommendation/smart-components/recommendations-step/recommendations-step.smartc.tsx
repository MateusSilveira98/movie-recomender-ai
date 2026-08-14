import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { RUNTIME_PREFERENCE_LABELS } from '@pkg/shared/entities/consts/runtime-preference-labels.const';
import { formatMinutes } from '@pkg/shared/data-access/services/ui-services/movie-format.ui.service';
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

export function RecommendationsStep({
  recommendations,
  recommendationsStatus,
  recommendationsError,
  rounds,
  onFeedback,
  onStartNewRound,
}: RecommendationsStepProps) {
  const [activeTab, setActiveTab] = useState<RecommendationResultTab>('recommendations');
  const activeRound = rounds[0];

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
              <Tab label={`Gostei (${activeRound?.history.liked.length ?? 0})`} value="liked" />
              <Tab label={`Nao gostei (${activeRound?.history.disliked.length ?? 0})`} value="disliked" />
              <Tab label={`Historico (${rounds.length})`} value="rounds" />
            </Tabs>
          </Stack>
        </CardContent>
      </Card>

      {recommendationsStatus === 'error' && (
        <Alert severity="error">{recommendationsError ?? 'Nao foi possivel falar com a API.'}</Alert>
      )}

      {activeTab === 'recommendations' && (
        <RecommendationsList
          recommendations={recommendations}
          status={recommendationsStatus}
          onFeedback={onFeedback}
        />
      )}
      {activeTab === 'liked' && <RoundFeedback round={activeRound} opinion="liked" />}
      {activeTab === 'disliked' && <RoundFeedback round={activeRound} opinion="disliked" />}
      {activeTab === 'rounds' && <RecommendationRoundsHistory rounds={rounds} />}
    </Stack>
  );
}

function RoundFeedback({
  round,
  opinion,
}: {
  round: RecommendationsStepProps['rounds'][number] | undefined;
  opinion: 'liked' | 'disliked';
}) {
  const isLiked = opinion === 'liked';
  const movieIds = round?.history[opinion] ?? [];
  const label = isLiked ? 'Filmes que vc marcou como gostei' : 'Filmes que vc marcou como nao gostei';

  return (
    <Card variant="outlined">
      <CardContent>
        <HistoryLine label={label} movieIds={movieIds} movieTitles={round?.movieTitles} />
      </CardContent>
    </Card>
  );
}

function RecommendationsList({
  recommendations,
  status,
  onFeedback,
}: Pick<RecommendationsStepProps, 'recommendations' | 'onFeedback'> & { status: RecommendationsStepProps['recommendationsStatus'] }) {
  if (status === 'loading') {
    return (
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <CircularProgress size={20} />
        <Typography color="text.secondary">Buscando recomendacoes na API...</Typography>
      </Stack>
    );
  }

  if (status === 'success' && recommendations.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography color="text.secondary">
            Nenhuma recomendacao encontrada para essas preferencias. Tente ajustar generos ou clima.
          </Typography>
        </CardContent>
      </Card>
    );
  }

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
                <Chip color="primary" label={`${movie.matchPercentage ?? 0}% match`} />
              </Stack>
              <Typography>{movie.reason}.</Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {movie.genres.map((genre) => (
                  <Chip key={genre} label={genre} size="small" variant="outlined" />
                ))}
                <Chip label={formatMinutes(movie.runtime)} size="small" variant="outlined" />
              </Stack>
              <ToggleButtonGroup exclusive size="small" onChange={(_, value: 'liked' | 'disliked' | null) => {
                if (value) {
                  onFeedback(movie.impressionId, value);
                }
              }}>
                <ToggleButton value="liked" aria-label={`Gostei de ${movie.title}`}>
                  <ThumbUpIcon fontSize="small" sx={{ mr: 1 }} />
                  Gostei
                </ToggleButton>
                <ToggleButton value="disliked" aria-label={`Nao gostei de ${movie.title}`}>
                  <ThumbDownIcon fontSize="small" sx={{ mr: 1 }} />
                  Nao gostei
                </ToggleButton>
              </ToggleButtonGroup>
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
      {rounds.map((round, index) => {
        return (
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
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2">
                        {movie.title} ({movie.year})
                      </Typography>
                      <Chip label={`${movie.matchPercentage ?? 0}% match`} size="small" variant="outlined" />
                    </Stack>
                    <Typography color="text.secondary" variant="body2">
                      {movie.reason}.
                    </Typography>
                  </Box>
                ))}
              </Stack>

              <Stack spacing={2}>
                <Typography variant="subtitle2">Sinais usados</Typography>
                <HistoryLine label="Visualizados" movieIds={round.history.watched} movieTitles={round.movieTitles} />
                <HistoryLine label="Gostei" movieIds={round.history.liked} movieTitles={round.movieTitles} />
                <HistoryLine label="Nao gostei" movieIds={round.history.disliked} movieTitles={round.movieTitles} />
              </Stack>
            </Stack>
          </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}

function formatRoundDate(createdAt: string): string {
  return roundDateFormatter.format(new Date(createdAt));
}
