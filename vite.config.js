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
        // A FUNCTION, NOT THE ARRAY FORM, AND THE REASON IS MEASURED.
        //
        // `manualChunks: { 'vendor-react': ['react', 'react-dom'] }` produced a
        // `vendor-react` chunk of **0.00 kB**. The array form matches the bare
        // package entry, but `@vitejs/plugin-react` uses the automatic JSX
        // runtime, so components import `react/jsx-runtime` and the app imports
        // `react-dom/client` — different module ids that the array never caught.
        // React-DOM therefore landed in a shared chunk that Rollup named after
        // whichever module anchored it: `WhyPanel-*.js`, 386 kB, for a source
        // file of 10 kB that imports nothing but React and a font token. A
        // vendor chunk named after a page is re-fetched whenever that page's
        // graph changes, which is the opposite of what pinning vendors is for.
        //
        // Matching on the resolved path under `node_modules` catches every
        // sub-path entry instead.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const p = id.replace(/\\/g, '/');

          // MONACO CORE ONLY. `basic-languages/` is deliberately LEFT ALONE so
          // Rollup keeps emitting one lazy chunk per Monarch grammar — that is
          // what makes ~90 languages available on demand instead of up front,
          // and folding them in here would undo it and build one larger blob.
          // Splitting the core out means editing IDE page code no longer
          // invalidates 4.2 MB of editor that never changed.
          if (p.includes('/node_modules/monaco-editor/')) {
            // THE GRAMMARS ARE AT `esm/vs/languages/definitions/<lang>/<lang>.js`,
            // which is MEASURED, not assumed. `esm/vs/basic-languages/` holds
            // exactly one file — `monaco.contribution.js`, the barrel — and an
            // exclusion aimed there silently caught nothing: the build dropped
            // from ~110 chunks to 30 and `vendor-monaco` grew to 4,596 kB,
            // because every one of the ~90 grammars had been folded in and
            // would download up front.
            //
            // Returning `undefined` to "let Rollup decide" does not work either,
            // also measured: once `vendor-monaco` claims the surrounding graph
            // the dynamic imports collapse into it. Each grammar therefore gets
            // an EXPLICIT chunk name, so opening a `.rs` file still fetches only
            // Rust and the ~90 languages stay available on demand.
            const lang = /\/languages\/definitions\/([^/]+)\//.exec(p);
            if (lang) return `lang-${lang[1]}`;
            return 'vendor-monaco';
          }

          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(p)) return 'vendor-react';
          if (p.includes('/node_modules/react-router')) return 'vendor-router';
          if (p.includes('/node_modules/zustand/')) return 'vendor-zustand';
          if (p.includes('/node_modules/lightweight-charts/')) return 'vendor-charts';
          return undefined;
        },
      },
    },
  },

  base: './',
})
