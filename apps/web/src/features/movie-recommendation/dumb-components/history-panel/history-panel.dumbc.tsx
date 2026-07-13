import VisibilityIcon from '@mui/icons-material/Visibility';
import { Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { HistoryLine } from '../history-line/history-line.dumbc';
import type { HistoryPanelProps } from './history-panel.interface';

export function HistoryPanel({ history }: HistoryPanelProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <VisibilityIcon color="primary" />
            <Typography variant="h6">Historico</Typography>
          </Stack>
          <Divider />
          <HistoryLine label="Visualizados" movieIds={history.watched} />
          <HistoryLine label="Gostei" movieIds={history.liked} />
          <HistoryLine label="Nao gostei" movieIds={history.disliked} />
        </Stack>
      </CardContent>
    </Card>
  );
}
