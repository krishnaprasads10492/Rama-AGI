import React, { useEffect, useRef, useState } from 'react';
import { setupMonaco, languageFor, RAMA_THEME } from './monacoSetup.js';

/**
 * CodeEditor — a real editor, bundled, offline, theme-aware (spec Section 82).
 *
 * ONE EDITOR INSTANCE PER MOUNT, MODELS SWAPPED PER FILE. Creating an editor per tab would lose
 * the view state — cursor, scroll, folds — every time master switched files, which is the whole
 * point of tabs. Monaco keeps one model per file and remembers view state against it, so this
 * holds a model cache keyed by path and saves/restores view state on every swap.
 *
 * IF MONACO FAILS TO LOAD, THE TEXTAREA COMES BACK. That fallback is not decoration: the previous
 * IDE was a textarea permanently, and a broken editor that shows nothing would be worse than the
 * thing it replaced. A failure is reported on screen rather than leaving an empty panel.
 */
export default function CodeEditor({
  path,
  value = '',
  onChange,
  onSave,
  readOnly = false,
  height = '100%',
}) {
  const holder = useRef(null);
  const editorRef = useRef(null);
  const modelsRef = useRef(new Map());
  const viewStateRef = useRef(new Map());
  const monacoRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const [failed, setFailed] = useState(null);

  // Kept in refs so the editor is created once and never re-created just because a parent
  // re-rendered with a new closure.
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  useEffect(() => {
    if (!holder.current) return undefined;
    let editor;
    let ro;
    try {
      const monaco = setupMonaco();
      monacoRef.current = monaco;

      editor = monaco.editor.create(holder.current, {
        value: '',
        language: 'plaintext',
        theme: RAMA_THEME,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontLigatures: false,
        lineNumbers: 'on',
        minimap: { enabled: true, scale: 1, renderCharacters: false },
        scrollBeyondLastLine: false,
        automaticLayout: false,
        renderLineHighlight: 'all',
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        tabSize: 2,
        insertSpaces: true,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        padding: { top: 10, bottom: 10 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        readOnly,
        // Word-based suggestions come from the base worker and need no language service.
        wordBasedSuggestions: 'currentDocument',
        quickSuggestions: { other: true, comments: false, strings: false },
      });
      editorRef.current = editor;

      editor.onDidChangeModelContent(() => {
        onChangeRef.current?.(editor.getValue());
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current?.(editor.getValue());
      });

      // `automaticLayout` polls on a timer; observing the box is cheaper and reacts immediately
      // when the split layout changes.
      ro = new ResizeObserver(() => { try { editor.layout(); } catch { /* disposed */ } });
      ro.observe(holder.current);
    } catch (err) {
      console.error('[CodeEditor] Monaco failed to initialise', err);
      setFailed(err.message || String(err));
    }

    return () => {
      try { ro?.disconnect(); } catch { /* already gone */ }
      for (const m of modelsRef.current.values()) {
        try { m.dispose(); } catch { /* already gone */ }
      }
      modelsRef.current.clear();
      viewStateRef.current.clear();
      try { editor?.dispose(); } catch { /* already gone */ }
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the model when the file changes, preserving each file's own view state.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !path) return;

    const current = editor.getModel();
    if (current) {
      const prevPath = [...modelsRef.current.entries()]
        .find(([, m]) => m === current)?.[0];
      if (prevPath) viewStateRef.current.set(prevPath, editor.saveViewState());
    }

    let model = modelsRef.current.get(path);
    if (!model || model.isDisposed()) {
      model = monaco.editor.createModel(value, languageFor(path));
      modelsRef.current.set(path, model);
    }
    editor.setModel(model);

    const saved = viewStateRef.current.get(path);
    if (saved) editor.restoreViewState(saved);
    editor.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // An external content change — a saved patch, a reload from disk — must land in the model
  // without wiping the cursor, which is why this compares before writing.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model || model.getValue() === value) return;
    const state = editor.saveViewState();
    model.setValue(value ?? '');
    if (state) editor.restoreViewState(state);
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  if (failed) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--gold)',
          borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        }}>
          Editor could not start ({failed}) — plain text editing still works.
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1, resize: 'none', outline: 'none', border: 'none',
            background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'var(--font)', fontSize: 14, lineHeight: 1.7, padding: 16, tabSize: 2,
          }}
        />
      </div>
    );
  }

  return <div ref={holder} style={{ position: 'absolute', inset: 0, height }} />;
}
