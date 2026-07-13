import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import { Box, Button, Card, CardContent, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import type { ViewerHistory } from '@movie-recomender-ai/shared/entities/models/viewer-history.model';
import type { FeedbackStepProps } from './feedback-step.interface';

export function FeedbackStep({ history, watchedMovies, onBack, onContinue, onOpinionChange }: FeedbackStepProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h5">Dos assistidos, quais vc gostou?</Typography>
            <Typography color="text.secondary">
              Marcar gostei e nao gostei ajuda a separar recomendacao parecida de recomendacao ruim.
            </Typography>
          </Box>

          {watchedMovies.length === 0 ? (
            <Typography color="text.secondary">
              Nenhum filme marcado como assistido. Pode seguir mesmo assim, mas a recomendacao vai depender so das
              preferencias.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {watchedMovies.map((movie) => (
                <Card key={movie.id} variant="outlined">
                  <CardContent>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={2}
                      sx={{ alignItems: { xs: 'stretch', md: 'center' }, justifyContent: 'space-between' }}
                    >
                      <Box>
                        <Typography variant="subtitle1">{movie.title}</Typography>
                        <Typography color="text.secondary" variant="body2">
                          {movie.description}
                        </Typography>
                      </Box>
                      <ToggleButtonGroup
                        exclusive
                        value={getOpinionValue(history, movie.id)}
                        onChange={(_, value: 'liked' | 'disliked' | null) => {
                          if (value) {
                            onOpinionChange(movie.id, value);
                          }
                        }}
                        size="small"
                      >
                        <ToggleButton value="liked">
                          <ThumbUpIcon fontSize="small" sx={{ mr: 1 }} />
                          Gostei
                        </ToggleButton>
                        <ToggleButton value="disliked">
                          <ThumbDownIcon fontSize="small" sx={{ mr: 1 }} />
                          Nao gostei
                        </ToggleButton>
                      </ToggleButtonGroup>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button variant="outlined" onClick={onBack}>
              Voltar
            </Button>
            <Button variant="contained" onClick={onContinue}>
              Ver recomendacoes
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function getOpinionValue(history: ViewerHistory, movieId: string): 'liked' | 'disliked' | null {
  if (history.liked.includes(movieId)) {
    return 'liked';
  }

  if (history.disliked.includes(movieId)) {
    return 'disliked';
  }

  return null;
}
