import { defineConfig } from 'vite';

// Relative base so the static build runs from any local folder or static server.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as never);
