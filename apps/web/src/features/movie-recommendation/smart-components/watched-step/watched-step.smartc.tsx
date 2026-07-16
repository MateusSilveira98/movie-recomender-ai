import { Alert, Box, Button, Card, CardContent, Checkbox, CircularProgress, FormControlLabel, Stack, Typography } from '@mui/material';
import type { WatchedStepProps } from './watched-step.interface';

export function WatchedStep({
  history,
  movies,
  moviesStatus,
  onBack,
  onContinue,
  onRetryMovies,
  onWatchedToggle,
}: WatchedStepProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h5">Quais filmes vc ja assistiu?</Typography>
            <Typography color="text.secondary">
              Mostramos ate 10 filmes populares dentro das suas preferencias pra capturar sinal rapido.
            </Typography>
          </Box>

          {moviesStatus === 'loading' && (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} />
              <Typography color="text.secondary">Carregando catalogo da API...</Typography>
            </Stack>
          )}

          {moviesStatus === 'error' && (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={onRetryMovies}>
                  Tentar de novo
                </Button>
              }
            >
              Nao foi possivel carregar o catalogo de filmes da API.
            </Alert>
          )}

          {moviesStatus === 'success' && movies.length === 0 && (
            <Typography color="text.secondary">Nenhum filme disponivel no catalogo.</Typography>
          )}

          {moviesStatus === 'success' && movies.length > 0 && (
            <Stack spacing={1}>
              {movies.map((movie) => (
                <FormControlLabel
                  key={movie.id}
                  control={<Checkbox checked={history.watched.includes(movie.id)} onChange={() => onWatchedToggle(movie.id)} />}
                  label={`${movie.title} (${movie.year}) - ${movie.genres.join(', ')} - ${formatRuntime(movie.runtime)}`}
                />
              ))}
            </Stack>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button variant="outlined" onClick={onBack}>
              Voltar
            </Button>
            <Button variant="contained" onClick={onContinue} disabled={moviesStatus !== 'success'}>
              Continuar
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function formatRuntime(runtime: number): string {
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;

  if (hours === 0) {
    return `${minutes}min`;
  }

  return `${hours}h ${String(minutes).padStart(2, '0')}min`;
}
