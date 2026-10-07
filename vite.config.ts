import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * base нужен для GitHub Pages:
 *   project site  https://<user>.github.io/<repo>/  → VITE_BASE_PATH=/<repo>/
 *   user site     https://<user>.github.io/         → VITE_BASE_PATH=/ (по умолчанию)
 *
 * В workflow деплоя переменная подставляется автоматически из имени репозитория.
 */
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
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
