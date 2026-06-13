import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8100'
  const wsTarget = env.VITE_WS_PROXY_TARGET || 'ws://localhost:8100'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      proxy: {
        '/api': apiTarget,
        '/auth': apiTarget,
        '/ws': { target: wsTarget, ws: true },
      },
    },
  }
})
