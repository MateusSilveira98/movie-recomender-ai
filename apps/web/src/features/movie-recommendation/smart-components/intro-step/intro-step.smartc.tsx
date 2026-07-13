import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import type { IntroStepProps } from './intro-step.interface';

export function IntroStep({ hasStoredSession, onAdvance, onResume }: IntroStepProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Typography variant="h5">Escolher filme nao precisa virar uma pesquisa infinita.</Typography>
          <Typography color="text.secondary">
            Responda algumas perguntas, marque filmes que vc ja assistiu e diga do que gostou. Depois disso, a
            lista fica pronta e melhora nas proximas rodadas.
          </Typography>
          {hasStoredSession && (
            <Chip color="primary" label="Existe uma rodada salva neste navegador" sx={{ alignSelf: 'flex-start' }} />
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button variant="contained" size="large" onClick={onAdvance}>
              Avancar
            </Button>
            {hasStoredSession && (
              <Button variant="outlined" size="large" onClick={onResume}>
                Ver recomendacoes salvas
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
