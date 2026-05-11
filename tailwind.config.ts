import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          base: '#0d0d18',
          raised: '#12121e',
          overlay: '#1a1a2e',
          muted: '#1e1e3a',
        },
        ink: {
          DEFAULT: '#e0d9c8',
          muted: '#aaa',
          faint: '#666',
        },
        accent: {
          DEFAULT: '#8888ff',
          muted: '#4a4a7a',
        },
        choice: {
          spare: '#88cc88',
          'spare-bg': '#1a2a1a',
          'spare-border': '#3a5a3a',
          kill: '#cc8888',
          'kill-bg': '#2a1a1a',
          'kill-border': '#5a3a3a',
        },
      },
    },
  },
  plugins: [],
}

export default config
