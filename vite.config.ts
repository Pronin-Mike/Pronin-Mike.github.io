import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Для user site https://<user>.github.io/ base остаётся '/'.
 */
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'legacy-static/**']
  }
});
