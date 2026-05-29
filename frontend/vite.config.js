import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Загружаем переменные окружения (.env, .env.local) для текущего режима.
  // VITE_API_TARGET задаёт, куда проксировать /api в dev-режиме.
  const env = loadEnv(mode, process.cwd(), '')

  // По умолчанию — локальный бэкенд (например, `npx wrangler pages dev`),
  // чтобы случайно не работать с боевой БД при `npm run dev`.
  // Чтобы намеренно бить в прод — задай VITE_API_TARGET в .env.local.
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:8788'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: apiTarget.startsWith('https'),
        },
      },
    },
  }
})
