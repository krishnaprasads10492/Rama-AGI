import React, { useEffect, useRef, useState } from 'react';
import { term } from './glossary.js';

/**
 * InfoTip — the `?` beside a label, reading from the glossary (spec Section 104).
 *
 * WHY NOT JUST A `title` ATTRIBUTE. Three reasons, and the third is the one that decided it.
 *   - A native tooltip cannot be reached from a keyboard, so the explanation is mouse-only.
 *   - It has no styling, wraps badly at the length these definitions need, and vanishes on move.
 *   - It is invisible until hovered, so master cannot SEE that an explanation exists. A visible `?`
 *     is the affordance; the popover is the content.
 *
 * `title` is kept on the button as well, so a hover still works before anything is clicked. That is
 * additive, not a replacement.
 *
 * A MISSING TERM RENDERS NOTHING rather than a broken marker. `scripts/verifyGlossary.mjs` fails the
 * suite if a component names a term that does not exist, so a silent absence here can only mean the
 * suite was not run — and an empty space is better than a `?` that opens onto nothing.
 */
export default function InfoTip({ id, side = 'right' }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const t = term(id);

  // The effect is declared BEFORE the early return. A `return null` above a hook changes the number of
  // hooks between renders, which React treats as a corrupted component — and it would only break once
  // a term id went missing, which is the least convenient moment to discover it.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!t) return null;

  return (
    <span ref={boxRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-label={`What is ${t.term}?`}
        title={t.short}
        style={{
          width: '15px', height: '15px', lineHeight: '13px', padding: 0, marginLeft: '4px',
          borderRadius: '50%', border: '1px solid var(--border)', background: 'transparent',
          color: 'var(--muted)', fontSize: '11px', cursor: 'pointer', flexShrink: 0,
        }}
      >?</button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', zIndex: 70, top: '18px',
            [side === 'right' ? 'left' : 'right']: 0,
            width: '290px', padding: '8px 10px', textAlign: 'left',
            background: 'var(--panel, #131722)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius, 6px)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            fontSize: '12.5px', lineHeight: 1.6, color: 'var(--text-dim, var(--muted))',
            fontWeight: 400, letterSpacing: 0, textTransform: 'none',
          }}
        >
          <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '3px' }}>
            {t.term}
          </strong>
          {t.long}
          <span style={{ display: 'block', marginTop: '6px', color: 'var(--muted)',
            fontSize: '12px' }}>
            Full glossary in the HELP tab.
          </span>
        </span>
      )}
    </span>
  );
}
