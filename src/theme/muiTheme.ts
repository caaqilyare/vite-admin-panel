import { createTheme } from '@mui/material/styles'

export const muiTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7c3aed' }, // purple
    secondary: { main: '#22c55e' }, // green
    background: {
      default: '#0a0c12',
      paper: '#0b0f1a',
    },
  },
  typography: {
    fontFamily: 'Outfit, system-ui, Avenir, Helvetica, Arial, sans-serif',
    h1: { fontWeight: 800 },
    h2: { fontWeight: 800 },
    h3: { fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.08)'
        }
      }
    },
  }
})
