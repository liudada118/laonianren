import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      // 后端 HTTP API 代理
      '/api/backend': {
        target: 'http://localhost:19245',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/backend/, ''),
      },
      // Python FastAPI 代理
      '/pyapi': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pyapi/, ''),
      },
      // 后端 WebSocket 代理
      '/ws/backend': {
        target: 'ws://localhost:19999',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws\/backend/, ''),
      },
    },
  }
})
