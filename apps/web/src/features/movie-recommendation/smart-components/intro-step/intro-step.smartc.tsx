import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import type { IntroStepProps } from './intro-step.interface';

export function IntroStep({ hasStoredSession, onAdvance, onResume }: IntroStepProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Typography variant="h5">Escolher um filme não precisa virar uma pesquisa infinita.</Typography>
          <Typography color="text.secondary">
            Responda a algumas perguntas, marque os filmes que você já assistiu e diga do que gostou. Depois disso, a
            lista ficará pronta e melhorará nas próximas rodadas.
          </Typography>
          {hasStoredSession && (
            <Chip color="primary" label="Existe uma rodada ativa neste navegador" sx={{ alignSelf: 'flex-start' }} />
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Button variant="contained" size="large" onClick={onAdvance}>
                Avançar
              </Button>
            {hasStoredSession && (
              <Button variant="outlined" size="large" onClick={onResume}>Ver recomendações da rodada atual</Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
