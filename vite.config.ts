/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` makes the build work from any sub-path, e.g. GitHub Pages
// (https://<user>.github.io/<repo>/) or a folder on your own website.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // three.js alone is ~700 kB; that's expected for a 3D app.
  build: { chunkSizeWarningLimit: 1200 },
  // Full slicing runs (e.g. a 300 mm cube) take a few seconds and can pass 5 s on shared CI runners.
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
