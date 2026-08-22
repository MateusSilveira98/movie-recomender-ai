import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@pkg/shared': new URL('../../packages/shared/src', import.meta.url).pathname,
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    include: ['apps/web/src/**/*.spec.{ts,tsx}'],
    setupFiles: './apps/web/src/test/setup.ts',
  },
});
