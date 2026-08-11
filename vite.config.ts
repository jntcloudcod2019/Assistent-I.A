import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      // O front fala com o mesmo origin; o proxy evita CORS e mantém a URL
      // idêntica em desenvolvimento e produção.
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        // Sem isto o Vite bufferiza a resposta e o SSE chega todo de uma vez.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache, no-transform'
          })
        },
      },
    },
  },
})
