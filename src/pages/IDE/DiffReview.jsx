import React, { useEffect, useMemo, useRef, useState } from 'react';
import { setupMonaco, languageFor, RAMA_THEME } from './monacoSetup.js';

/**
 * DiffReview — see exactly what the AI changed, before it touches the file (spec Section 82).
 *
 * WHY THIS IS THE PIECE THAT MATTERED MOST. The IDE already had a patch path: the AI returned code
 * and `onApplyPatch` wrote it. What it did not have was any way to see WHAT would change. Applying
 * an edit you cannot inspect is the one genuinely dangerous thing an assistant can do to a
 * codebase, and it is the difference between a tool master can trust with his own source and one
 * he cannot.
 *
 * Nothing is written until Apply is pressed. Rejecting is the default action — Escape and the
 * backdrop both discard, and the primary button is deliberately not focus-stealing.
 *
 * The diff is computed by Monaco's base editor worker, which `monacoSetup` inlines as a blob
 * precisely so this works from a `file://` document.
 */
export default function DiffReview({
  path,
  original = '',
  modified = '',
  onApply,
  onReject,
  note = null,
}) {
  const holder = useRef(null);
  const diffRef = useRef(null);
  const modelsRef = useRef(null);
  const [stats, setStats] = useState(null);
  const [failed, setFailed] = useState(null);
  const [inline, setInline] = useState(false);

  const language = useMemo(() => languageFor(path), [path]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onReject?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onReject]);

  useEffect(() => {
    if (!holder.current) return undefined;
    let editor;
    let ro;
    try {
      const monaco = setupMonaco();
      editor = monaco.editor.createDiffEditor(holder.current, {
        theme: RAMA_THEME,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: !inline,
        automaticLayout: false,
        fontSize: 13.5,
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        lineNumbers: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: true,
        ignoreTrimWhitespace: false,
      });

      const models = {
        original: monaco.editor.createModel(original ?? '', language),
        modified: monaco.editor.createModel(modified ?? '', language),
      };
      editor.setModel(models);
      diffRef.current = editor;
      modelsRef.current = models;

      // Counting from the computed line changes rather than diffing again in JS keeps one source
      // of truth for what the reviewer is looking at.
      const readStats = () => {
        try {
          const changes = editor.getLineChanges() || [];
          let added = 0;
          let removed = 0;
          for (const ch of changes) {
            if (ch.modifiedEndLineNumber > 0) {
              added += ch.modifiedEndLineNumber - ch.modifiedStartLineNumber + 1;
            }
            if (ch.originalEndLineNumber > 0) {
              removed += ch.originalEndLineNumber - ch.originalStartLineNumber + 1;
            }
          }
          setStats({ hunks: changes.length, added, removed });
        } catch { /* diff not ready */ }
      };
      editor.onDidUpdateDiff(readStats);

      ro = new ResizeObserver(() => { try { editor.layout(); } catch { /* disposed */ } });
      ro.observe(holder.current);
    } catch (err) {
      console.error('[DiffReview] Monaco diff failed', err);
      setFailed(err.message || String(err));
    }

    return () => {
      try { ro?.disconnect(); } catch { /* gone */ }
      try { modelsRef.current?.original.dispose(); } catch { /* gone */ }
      try { modelsRef.current?.modified.dispose(); } catch { /* gone */ }
      try { editor?.dispose(); } catch { /* gone */ }
      diffRef.current = null;
      modelsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, modified, language]);

  useEffect(() => {
    diffRef.current?.updateOptions({ renderSideBySide: !inline });
  }, [inline]);

  const identical = (original ?? '') === (modified ?? '');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Review changes to ${path || 'file'}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(3,8,16,0.82)', backdropFilter: 'blur(3px)', padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onReject?.(); }}
    >
      <div className="hud-card" style={{
        width: '100%', maxWidth: 1240, height: '86%', display: 'flex',
        flexDirection: 'column', overflow: 'hidden', padding: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0,
          flexWrap: 'wrap',
        }}>
          <span className="section-label" style={{ margin: 0 }}>REVIEW CHANGES</span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', fontWeight: 700 }}>
            {path || 'untitled'}
          </span>
          {stats && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              {stats.hunks} hunk{stats.hunks === 1 ? '' : 's'} ·{' '}
              <span style={{ color: 'var(--green)' }}>+{stats.added}</span>{' '}
              <span style={{ color: 'var(--red)' }}>−{stats.removed}</span>
            </span>
          )}
          {identical && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gold)' }}>
              the proposal is identical to the file — nothing would change
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => setInline((v) => !v)}>
            {inline ? '⇄ side by side' : '≡ inline'}
          </button>
        </div>

        {note && (
          <div style={{
            padding: '8px 16px', fontSize: 'var(--text-xs)', color: 'var(--text-dim)',
            borderBottom: '1px solid var(--border-soft, var(--border))', lineHeight: 1.6,
          }}>
            {note}
          </div>
        )}

        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {failed ? (
            <div style={{ padding: 16, fontSize: 'var(--text-sm)', color: 'var(--gold)' }}>
              The diff view could not start ({failed}). Applying blind is not offered — copy the
              proposed content from the AI panel and edit by hand instead.
            </div>
          ) : (
            <div ref={holder} style={{ position: 'absolute', inset: 0 }} />
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
          borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
            Nothing is written to disk until you apply. Escape discards.
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => onReject?.()}>Discard</button>
          <button
            className="btn btn-sm btn-primary"
            disabled={!!failed || identical}
            onClick={() => onApply?.(modified)}
          >
            Apply to editor
          </button>
        </div>
      </div>
    </div>
  );
}
