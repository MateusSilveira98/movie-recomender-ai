import { Box, Chip, Stack, Typography } from '@mui/material';
import { MOVIE_CATALOG_MOCK } from '@movie-recomender-ai/shared/mocks/movie';
import type { HistoryLineProps } from './history-line.interface';

export function HistoryLine({ label, movieIds }: HistoryLineProps) {
  const movies = MOVIE_CATALOG_MOCK.filter((movie) => movieIds.includes(movie.id));

  return (
    <Box>
      <Typography variant="subtitle2">{label}</Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
        {movies.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            Nenhum filme ainda.
          </Typography>
        ) : (
          movies.map((movie) => <Chip key={movie.id} label={movie.title} size="small" />)
        )}
      </Stack>
    </Box>
  );
}
