/// <reference types="vitest" />

import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  cacheDir: '/tmp/vite-cache-lss',
  resolve: {
    alias: {
      '@lss/schemas': path.join(repoRoot, 'packages/schemas'),
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    cache: { dir: '/tmp/vitest-cache-lss' },
  }
})
