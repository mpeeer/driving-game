import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages project sites live under /<repo>/, so built asset URLs are relative.
  base: command === 'build' ? './' : '/',
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
}));
