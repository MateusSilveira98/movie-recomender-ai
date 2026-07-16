import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { RUNTIME_PREFERENCE_OPTIONS } from '@movie-recomender-ai/shared/entities/consts/runtime-preference-options.const';
import type { RuntimePreference } from '@movie-recomender-ai/shared/entities/types/runtime-preference.type';
import type { PreferencesStepProps } from './preferences-step.interface';

export function PreferencesStep({
  preferences,
  genreOptions,
  genreOptionsStatus,
  onBack,
  onContinue,
  onGenreToggle,
  onRetryGenres,
  onRuntimeChange,
}: PreferencesStepProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h5">Quais preferencias importam hoje?</Typography>
            <Typography color="text.secondary">
              Escolha generos e duracao. Isso ja da sinal suficiente pra primeira versao.
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Generos
            </Typography>
            {genreOptionsStatus === 'loading' && (
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <CircularProgress size={20} />
                <Typography color="text.secondary">Carregando generos da API...</Typography>
              </Stack>
            )}

            {genreOptionsStatus === 'error' && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={onRetryGenres}>
                    Tentar de novo
                  </Button>
                }
              >
                Nao foi possivel carregar os generos da API.
              </Alert>
            )}

            {genreOptionsStatus === 'success' && genreOptions.length === 0 && (
              <Typography color="text.secondary">Nenhum genero disponivel.</Typography>
            )}

            {genreOptionsStatus === 'success' && genreOptions.length > 0 && (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {genreOptions.map((genre) => (
                  <Chip
                    key={genre}
                    label={genre}
                    color={preferences.genres.includes(genre) ? 'primary' : 'default'}
                    onClick={() => onGenreToggle(genre)}
                    variant={preferences.genres.includes(genre) ? 'filled' : 'outlined'}
                  />
                ))}
              </Stack>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Duracao
            </Typography>
            <ToggleButtonGroup
              exclusive
              value={preferences.runtime}
              onChange={(_, value: RuntimePreference | null) => {
                if (value) {
                  onRuntimeChange(value);
                }
              }}
              sx={{ flexWrap: 'wrap', gap: 1 }}
            >
              {RUNTIME_PREFERENCE_OPTIONS.map((option) => (
                <ToggleButton key={option.value} value={option.value}>
                  {option.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button variant="outlined" onClick={onBack}>
              Voltar
            </Button>
            <Button
              variant="contained"
              onClick={onContinue}
              disabled={genreOptionsStatus !== 'success' || preferences.genres.length === 0}
            >
              Continuar
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
