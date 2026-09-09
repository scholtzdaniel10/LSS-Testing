/// <reference types="vitest" />

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite'

const webRoot = path.dirname(fileURLToPath(import.meta.url))
const archifyRoot = path.resolve(webRoot, '../../packages/archify')
const archifyTemplate = path.join(archifyRoot, 'vendor/assets/template.html')
const TEMPLATE_ID = '\0lss-archify-template'

function archifyTemplatePlugin(): Plugin {
  return {
    name: 'lss-archify-template',
    resolveId(id) {
      if (id === '@lss-archify-template' || id === '@lss-archify-template?raw') {
        return TEMPLATE_ID
      }
      return undefined
    },
    load(id) {
      if (id !== TEMPLATE_ID) return undefined
      const html = fs.readFileSync(archifyTemplate, 'utf8')
      return `export default ${JSON.stringify(html)}`
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    archifyTemplatePlugin(),
    react(),
  ],
  cacheDir: '/tmp/vite-cache-lss',
  resolve: {
    alias: {
      '@lss/archify': path.join(archifyRoot, 'src/index.mjs'),
    },
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(webRoot), archifyRoot],
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
  },
})
