import { Box, Chip, Stack, Typography } from '@mui/material';
import type { HistoryLineProps } from './history-line.interface';

export function HistoryLine({ label, movieIds, movieTitles }: HistoryLineProps) {
  return (
    <Box>
      <Typography variant="subtitle2">{label}</Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
        {movieIds.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            Nenhum filme ainda.
          </Typography>
        ) : (
          movieIds.map((movieId) => <Chip key={movieId} label={movieTitles?.[movieId] ?? 'Filme selecionado'} size="small" />)
        )}
      </Stack>
    </Box>
  );
}
