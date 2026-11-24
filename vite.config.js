import { defineConfig } from 'vite';

// In dev, proxy API + WebSocket calls to the backend so no CORS setup is needed.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
