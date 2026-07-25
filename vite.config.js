import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],

  // Point Vite at the public dir where index.html lives
  root:      '.',
  publicDir: 'public',

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
      input: path.resolve(__dirname, 'public/index.html'),
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
