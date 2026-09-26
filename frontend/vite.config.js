import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev we proxy /api to the local Express backend so the frontend can use
// relative URLs. In production set VITE_API_URL to the Render backend origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/health': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
