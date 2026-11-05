import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'web/index.html'),
        login: resolve(import.meta.dirname, 'web/login.html'),
      },
    },
  },
  server: {
    port: 5173,
    // Dev only: the Hono server handles auth and the API. Host header is kept so
    // the server's CSRF Origin check sees the same host as the browser.
    proxy: {
      '/api': { target: backend },
      '/login': { target: backend },
      '/logout': { target: backend },
    },
  },
});
