import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the API (apps/api, Fastify) runs on :3001 under /api (API_PROXY_TARGET overrides, e.g. a second local stack).
const API = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: API, changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
