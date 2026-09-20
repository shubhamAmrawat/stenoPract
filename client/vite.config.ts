import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on :4000. Proxying /api makes the browser see ONE origin (localhost:5173),
// so the session cookie "just works" with no CORS or SameSite headaches in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
})
