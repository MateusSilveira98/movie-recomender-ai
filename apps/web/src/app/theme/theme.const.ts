import { createTheme } from '@mui/material';

export const theme = createTheme({
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
