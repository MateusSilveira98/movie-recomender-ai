import { Box, Button, Card, CardContent, Chip, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { GENRE_OPTIONS } from '@movie-recomender-ai/shared/entities/consts/genre-options.const';
import { MOOD_OPTIONS } from '@movie-recomender-ai/shared/entities/consts/mood-options.const';
import { RUNTIME_PREFERENCE_OPTIONS } from '@movie-recomender-ai/shared/entities/consts/runtime-preference-options.const';
import type { RuntimePreference } from '@movie-recomender-ai/shared/entities/types/runtime-preference.type';
import type { PreferencesStepProps } from './preferences-step.interface';

export function PreferencesStep({
  preferences,
  onBack,
  onContinue,
  onFreeTextChange,
  onGenreToggle,
  onMoodToggle,
  onRuntimeChange,
}: PreferencesStepProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h5">Quais preferencias importam hoje?</Typography>
            <Typography color="text.secondary">
              Escolha generos, climas e duracao. Isso ja da sinal suficiente pra primeira versao.
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Generos
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {GENRE_OPTIONS.map((genre) => (
                <Chip
                  key={genre}
                  label={genre}
                  color={preferences.genres.includes(genre) ? 'primary' : 'default'}
                  onClick={() => onGenreToggle(genre)}
                  variant={preferences.genres.includes(genre) ? 'filled' : 'outlined'}
                />
              ))}
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Clima da sessao
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {MOOD_OPTIONS.map((mood) => (
                <Chip
                  key={mood}
                  label={mood}
                  color={preferences.moods.includes(mood) ? 'primary' : 'default'}
                  onClick={() => onMoodToggle(mood)}
                  variant={preferences.moods.includes(mood) ? 'filled' : 'outlined'}
                />
              ))}
            </Stack>
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

          <TextField
            label="Me conte o que vc quer ver hoje"
            placeholder="Ex: filme curto, sem terror pesado, bom pra ver em casal"
            value={preferences.freeText}
            onChange={(event) => onFreeTextChange(event.target.value)}
            multiline
            minRows={2}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button variant="outlined" onClick={onBack}>
              Voltar
            </Button>
            <Button
              variant="contained"
              onClick={onContinue}
              disabled={preferences.genres.length === 0 || preferences.moods.length === 0}
            >
              Continuar
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
