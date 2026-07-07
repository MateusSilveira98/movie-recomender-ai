import MovieFilterIcon from '@mui/icons-material/MovieFilter';
import {
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Stack,
  ThemeProvider,
  Typography,
  createTheme,
} from '@mui/material';
import { createSessionProfile, getHealthMessage } from '../../../../packages/shared/src';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1f7a4d',
    },
    secondary: {
      main: '#5b4b8a',
    },
    background: {
      default: '#f7f8f5',
    },
  },
  shape: {
    borderRadius: 8,
  },
});

const sessionProfile = createSessionProfile({
  genres: ['Ficcao cientifica', 'Suspense', 'Drama'],
  likedMovies: ['Matrix', 'Blade Runner'],
  dislikedMovies: ['Interestelar'],
});

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Stack spacing={4}>
          <Box>
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5, mb: 2 }}>
              <MovieFilterIcon color="primary" fontSize="large" />
              <Typography variant="h3" component="h1">
                Movie Recommender AI
              </Typography>
            </Box>
            <Typography variant="h6" color="text.secondary">
              Hello world do frontend React com Vite e Material UI.
            </Typography>
          </Box>

          <Box>
            <Typography variant="overline" color="text.secondary">
              Status do workspace
            </Typography>
            <Typography variant="h5">{getHealthMessage('web')}</Typography>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {sessionProfile.genres.map((genre) => (
              <Chip key={genre} label={genre} color="primary" variant="outlined" />
            ))}
          </Box>

          <Button variant="contained" size="large" sx={{ alignSelf: 'flex-start' }}>
            Encontrar recomendacoes
          </Button>
        </Stack>
      </Container>
    </ThemeProvider>
  );
}
