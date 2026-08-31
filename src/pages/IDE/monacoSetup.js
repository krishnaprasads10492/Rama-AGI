/**
 * monacoSetup.js — Monaco, bundled locally and safe under a `file://` origin (spec Section 82).
 *
 * WHAT WAS WRONG BEFORE. `IDE.jsx` defined a `useMonaco()` hook that loaded the editor from
 * `https://cdn.jsdelivr.net`. It was **never called** — dead code — so `monacoEditor` stayed null
 * forever and a plain `<textarea>` was the only editor, while the IDE header advertised "Monaco".
 * Even if it had been called it would have failed offline, and the packaged app loads the renderer
 * with `win.loadFile()`, so a remote script is exactly the wrong dependency for an editor.
 *
 * WHY THE EDITOR-ONLY BUILD RATHER THAN ALL OF `monaco-editor`.
 * Production runs from a `file://` origin. Chromium treats every `file://` document as an opaque
 * origin and refuses to start a worker from a sibling path, so Monaco's *language* workers
 * (TypeScript, JSON, CSS, HTML) cannot be loaded the normal way. Importing the whole package
 * wires those workers up eagerly and then fails at runtime asking for them.
 *
 * So this imports:
 *   - `editor.api`        the editor itself, including the DIFF editor
 *   - `editor.all`        find/replace, folding, multi-cursor, bracket matching, context menu
 *   - `basic-languages`   Monarch grammars for ~90 languages — highlighting with NO worker
 *
 * and inlines ONLY the small base editor worker, as a blob, which the CSP already permits
 * (`worker-src 'self' blob:`) and which a `file://` document is allowed to start. The base worker
 * is what computes diffs and word-based completions, so the diff review depends on it.
 *
 * WHAT THIS DOES NOT GIVE, stated rather than implied: cross-file IntelliSense, type checking and
 * schema validation, because those are the language workers that cannot run here. Serving the
 * renderer over a custom privileged protocol instead of `file://` would unlock them, and that is
 * a deliberate follow-up rather than something to change in the same pass as introducing the
 * editor — startup reliability took Sections 26, 29 and 32 to get right.
 */

// IMPORT PATHS OMIT `esm/vs/` DELIBERATELY. monaco-editor@0.56's `exports` map is
// `{"./*.js": "./esm/vs/*.js", "./*": "./esm/vs/*.js"}`, so it already prefixes `esm/vs/`.
// Writing `monaco-editor/esm/vs/editor/editor.api` resolves to `esm/vs/esm/vs/...` and the build
// fails with "Rollup failed to resolve import". This is the 0.56 shape, not the older one every
// tutorial still shows.
import * as monaco from 'monaco-editor/editor/editor.api.js';
// `features/register.all.js` is 0.56's barrel of editor contributions — find/replace, folding,
// multi-cursor, bracket matching, context menu, suggest widget. It replaced `editor/editor.all.js`,
// which no longer exists in this version.
import 'monaco-editor/features/register.all.js';
// Monarch grammars for ~90 languages. Highlighting only, and deliberately so: this needs NO web
// worker, unlike the `language/{typescript,json,css,html}` services, whose workers cannot start
// from a file:// document. Highlighting is the part that matters most over a textarea.
import 'monaco-editor/basic-languages/monaco.contribution.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker&inline';

let configured = false;

export const RAMA_THEME = 'rama-dark';

/**
 * Read the app's real design tokens instead of hardcoding a palette, so the editor follows the
 * theme — and so the contrast work in Section 81 applies here too.
 */
function tokenColours() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    bg:      get('--bg', '#030810'),
    surface: get('--surface', '#081426'),
    text:    get('--text', '#e8f4ff'),
    muted:   get('--muted', '#7794b5'),
    dim:     get('--text-dim', '#a8c4dd'),
    accent:  get('--accent', '#00c8ff'),
    gold:    get('--gold', '#d4a940'),
    green:   get('--green', '#00d68f'),
    red:     get('--red', '#ff4060'),
    violet:  get('--violet', '#6d61ff'),
    border:  get('--border', '#2f5f96'),
  };
}

const hex = (v, fallback) => {
  const s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.slice(1) : fallback;
};

export function setupMonaco() {
  if (configured) return monaco;
  configured = true;

  // Inlined as a blob so it works from a file:// document. Returning a worker that throws would
  // break the diff editor silently, so a failure here is reported rather than swallowed.
  self.MonacoEnvironment = {
    getWorker() {
      try {
        return new EditorWorker();
      } catch (err) {
        console.warn('[monaco] editor worker unavailable — diff and word suggestions will be '
          + `reduced: ${err.message}`);
        throw err;
      }
    },
  };

  const c = tokenColours();
  monaco.editor.defineTheme(RAMA_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '',         foreground: hex(c.text, 'e8f4ff') },
      { token: 'comment',  foreground: hex(c.muted, '7794b5'), fontStyle: 'italic' },
      { token: 'keyword',  foreground: hex(c.accent, '00c8ff') },
      { token: 'string',   foreground: hex(c.green, '00d68f') },
      { token: 'number',   foreground: hex(c.gold, 'd4a940') },
      { token: 'type',     foreground: hex(c.violet, '6d61ff') },
      { token: 'function', foreground: hex(c.dim, 'a8c4dd') },
      { token: 'variable', foreground: hex(c.text, 'e8f4ff') },
      { token: 'constant', foreground: hex(c.gold, 'd4a940') },
      { token: 'delimiter', foreground: hex(c.dim, 'a8c4dd') },
      { token: 'tag',      foreground: hex(c.accent, '00c8ff') },
      { token: 'attribute.name', foreground: hex(c.violet, '6d61ff') },
      { token: 'invalid',  foreground: hex(c.red, 'ff4060') },
    ],
    colors: {
      'editor.background':               c.bg,
      'editor.foreground':               c.text,
      'editorLineNumber.foreground':     c.muted,
      'editorLineNumber.activeForeground': c.accent,
      'editorCursor.foreground':         c.accent,
      'editor.selectionBackground':      `${c.accent}33`,
      'editor.lineHighlightBackground':  `${c.surface}`,
      'editorIndentGuide.background1':   c.border,
      'editorGutter.background':         c.bg,
      'editorWidget.background':         c.surface,
      'editorWidget.border':             c.border,
      'editorSuggestWidget.background':  c.surface,
      'editorSuggestWidget.border':      c.border,
      'editorSuggestWidget.selectedBackground': `${c.accent}22`,
      'diffEditor.insertedTextBackground': `${c.green}22`,
      'diffEditor.removedTextBackground':  `${c.red}22`,
      'scrollbarSlider.background':      `${c.border}88`,
      'minimap.background':              c.bg,
    },
  });

  return monaco;
}

/** Map a filename to a Monaco language id. */
export function languageFor(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return {
    js: 'javascript', jsx: 'javascript', cjs: 'javascript', mjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', json: 'json', md: 'markdown',
    css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', xml: 'xml',
    sh: 'shell', bash: 'shell', bat: 'bat', ps1: 'powershell', yml: 'yaml', yaml: 'yaml',
    rs: 'rust', go: 'go', sql: 'sql', java: 'java', c: 'c', h: 'c', cpp: 'cpp',
    cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', lua: 'lua',
    r: 'r', dockerfile: 'dockerfile', ini: 'ini', toml: 'ini', graphql: 'graphql',
  }[ext] || 'plaintext';
}

export { monaco };
