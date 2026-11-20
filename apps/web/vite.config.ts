import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the API (apps/api, Fastify) runs on :3001 under /api.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
