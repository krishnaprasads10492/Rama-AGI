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
    sourcemap:  process.env.RAMA_BUNDLE_AUDIT === '1',
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
          // VITE'S OWN PRELOAD HELPER GETS ITS OWN CHUNK, AND THIS IS THE SINGLE
          // MOST EXPENSIVE LINE IN THIS FILE.
          //
          // `__vitePreload(fn, deps, url)` is the ~1 kB helper every lazy route
          // is wrapped in. It is a VIRTUAL module, so it never matches
          // `node_modules` and fell through to "let Rollup decide" — and Rollup
          // decided to park it inside `vendor-monaco`. The entry chunk then
          // carried `import{_ as N}from"./vendor-monaco-*.js"`, a STATIC import,
          // because it needs the helper to lazy-load literally every page.
          //
          // So 4,083 kB of editor sat on the STARTUP path to supply one function,
          // while the record claimed monaco was lazy behind the IDE page. The
          // entry chunk did shrink from 287 kB to 113 kB as measured — but the
          // bytes before first paint went UP, which is the opposite of the point.
          //
          // Giving it a named chunk of its own is what breaks the dependency: the
          // entry imports a 1 kB helper, and monaco is reached only through the
          // dynamic import on the IDE route. `verifyBundleGraph.cjs` asserts the
          // entry's transitive STATIC closure, so this cannot silently come back.
          if (id.includes('vite/preload-helper')) return 'vite-preload';

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
            //
            // ONLY THE GRAMMAR. `register.js` MUST STAY WITH THE CORE, and the
            // first version of this rule (ledger row 160) got it wrong in a way
            // that CRASHED THE APP — see spec Section 140 for the reproduction.
            // Each `definitions/<lang>/` folder holds exactly two modules —
            // measured across all 81, zero irregular:
            //
            //   register.js   `import {registerLanguage} from '../_.contribution.js'`
            //                 then CALLS it at module top level
            //   <lang>.js     the Monarch grammar, reached only through that
            //                 registration's `loader: () => import('./<lang>.js')`
            //
            // A rule matching the whole folder put `register.js` in `lang-<lang>`
            // while `_.contribution.js` stayed in `vendor-monaco`. That made the
            // two chunks MUTUALLY STATIC: the barrel imports all 81 registers, so
            // `vendor-monaco` statically imported every `lang-*`, and every
            // `lang-*` statically imported `vendor-monaco` back for
            // `registerLanguage`. ESM hoists those imports, so `lang-abap` ran its
            // top-level `registerLanguage({...})` BEFORE `vendor-monaco` had
            // evaluated `const languageDefinitions = {}` — a textbook temporal
            // dead zone, surfacing in the packaged app as `Cannot access 'xse'
            // before initialization` (`xse` is that const, minified).
            //
            // It also silently undid the laziness this rule exists for: all 81
            // chunks were STATIC imports (measured: 81 static, 0 dynamic), and the
            // grammar sat in the chunk already eagerly loaded, so `loader()`
            // resolved to `Promise.resolve()` over a module that was always there.
            //
            // So the match is on the GRAMMAR FILE ALONE — basename equal to its
            // folder name. `register.js` and `_.contribution.js` both fall through
            // to `vendor-monaco`, nothing imports a `lang-*` statically, and each
            // grammar is reachable only by dynamic import. Verified by
            // `scripts/verifyBundleGraph.cjs` against the real build output.
            // The `(\?|$)` tail tolerates a Vite query suffix without loosening
            // the backreference that is doing the actual work.
            const lang = /\/languages\/definitions\/([^/]+)\/\1\.js(\?|$)/.exec(p);
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
