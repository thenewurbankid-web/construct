import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend defaults to http://localhost:4000 (see ui/server/src/index.mjs).
// Override with CONSTRUCT_UI_API if the backend runs elsewhere.
const apiTarget = process.env.CONSTRUCT_UI_API || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget, ws: true },
    },
  },
});
