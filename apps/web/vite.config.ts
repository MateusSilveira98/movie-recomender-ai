import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@movie-recomender-ai/recommender': new URL('../../packages/recommender/src/index.ts', import.meta.url).pathname,
      '@movie-recomender-ai/shared': new URL('../../packages/shared/src', import.meta.url).pathname,
    },
  },
  server: {
    port: 5173,
  },
});
