import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any folder (GitHub Pages, itch.io, file hosts).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
  },
});
