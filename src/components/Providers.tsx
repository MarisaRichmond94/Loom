'use client'

import { ThemeProvider, createTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#8888ff' },
    background: {
      default: '#0d0d18',
      paper: '#1a1a2e',
    },
    text: {
      primary: '#e0d9c8',
      secondary: '#aaaaaa',
    },
    divider: 'rgba(136,136,255,0.15)',
  },
  typography: {
    fontFamily: 'inherit',
    fontSize: 12,
  },
  components: {
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined' },
    },
    MuiSelect: {
      defaultProps: { size: 'small', variant: 'outlined' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(136,136,255,0.2)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(136,136,255,0.4)',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#8888ff',
          },
        },
        input: { padding: '4px 8px', color: '#e0d9c8' },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          color: '#666666',
          '&.Mui-focused': { color: '#8888ff' },
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          color: '#e0d9c8',
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: { fontSize: '0.65rem' },
      },
    },
  },
})

export default function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}
