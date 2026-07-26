import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],

  // index.html lives at the project root — Vite's convention, and the same
  // entry for dev and build. It used to sit in `public/`, which meant the dev
  // server had no entry to serve at all (spec section 29).
  root:      '.',
  publicDir: 'public',   // static assets only — never the entry

  resolve: {
    alias: {
      '@':           path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages':      path.resolve(__dirname, './src/pages'),
      '@services':   path.resolve(__dirname, './src/services'),
      '@store':      path.resolve(__dirname, './src/store'),
      '@config':     path.resolve(__dirname, './src/config'),
      '@hooks':      path.resolve(__dirname, './src/hooks'),
      '@utils':      path.resolve(__dirname, './src/utils'),
      // Definitions shared with the Electron main process and Express server
      '@shared':     path.resolve(__dirname, './shared'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4097', changeOrigin: true },
    },
  },

  build: {
    outDir:     'build',
    sourcemap:  false,
    target:     ['es2020', 'chrome87'],
    rollupOptions: {
      // No `input` override: the root index.html is the entry for both dev and
      // build. Overriding it here is what let dev and production diverge.
      output: {
        manualChunks: {
          'vendor-react':   ['react', 'react-dom'],
          'vendor-router':  ['react-router-dom'],
          'vendor-zustand': ['zustand'],
        },
      },
    },
  },

  base: './',
})
