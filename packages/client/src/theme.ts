import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: {
      main: '#96bf48',
      contrastText: '#ffffff',
    },
    background: {
      default: '#f6f6f6',
    },
  },
  typography: {
    fontFamily: '"Inter", "Helvetica", "Arial", sans-serif',
  },
  shape: {
    borderRadius: 8,
  },
});
