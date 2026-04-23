import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // FIX #12: proxy для dev-режима
  server: {
    proxy: {
      '/api': {
        target: 'https://chumi-app.pages.dev',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
