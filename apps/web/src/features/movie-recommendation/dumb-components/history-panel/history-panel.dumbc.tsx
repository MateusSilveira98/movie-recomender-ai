import VisibilityIcon from '@mui/icons-material/Visibility';
import { Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { HistoryLine } from '../history-line/history-line.dumbc';
import type { HistoryPanelProps } from './history-panel.interface';

export function HistoryPanel({ history, movieTitles }: HistoryPanelProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <VisibilityIcon color="primary" />
            <Typography variant="h6">Histórico</Typography>
          </Stack>
          <Divider />
          <HistoryLine label="Visualizados" movieIds={history.watched} movieTitles={movieTitles} />
          <HistoryLine label="Gostei" movieIds={history.liked} movieTitles={movieTitles} />
          <HistoryLine label="Não gostei" movieIds={history.disliked} movieTitles={movieTitles} />
        </Stack>
      </CardContent>
    </Card>
  );
}
