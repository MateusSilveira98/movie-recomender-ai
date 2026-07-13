import { Box, Button, Card, CardContent, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import { MOVIE_CATALOG_MOCK } from '@movie-recomender-ai/shared/mocks/movie';
import type { WatchedStepProps } from './watched-step.interface';

export function WatchedStep({ history, onBack, onContinue, onWatchedToggle }: WatchedStepProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h5">Quais filmes vc ja assistiu?</Typography>
            <Typography color="text.secondary">
              A lista prioriza filmes proximos das suas preferencias pra capturar sinal rapido.
            </Typography>
          </Box>

          <Stack spacing={1}>
            {MOVIE_CATALOG_MOCK.map((movie) => (
              <FormControlLabel
                key={movie.id}
                control={<Checkbox checked={history.watched.includes(movie.id)} onChange={() => onWatchedToggle(movie.id)} />}
                label={`${movie.title} (${movie.year}) - ${movie.genres.join(', ')}`}
              />
            ))}
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button variant="outlined" onClick={onBack}>
              Voltar
            </Button>
            <Button variant="contained" onClick={onContinue}>
              Continuar
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
