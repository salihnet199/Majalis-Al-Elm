import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // Paths are relative to this config's dir (apps/admin) — the Nx `test`
    // target runs vitest with cwd: apps/admin.
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
