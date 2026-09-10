import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * PanelBoard — draggable, resizable, poppable panels (spec Section 97).
 *
 * Master asked StockMind to become a multi-window showcase: draggable charts, pop-out screens, a more
 * futuristic feel. This is the substrate. It is a general component rather than StockMind-specific,
 * because the same thing is wanted for Resources and the IDE later.
 *
 * WRITTEN RATHER THAN INSTALLED. `react-grid-layout` and friends would each add a dependency for
 * behaviour that is a few hundred lines of pointer maths, and master's binding constraint through
 * this whole project has been disk. It also keeps I12's exact-pin discipline from growing another
 * entry that would then need its own upgrade review.
 *
 * ── ERGONOMIC DECISIONS, each guarding against a way floating windows go wrong ──
 *
 * DRAG BY THE HEADER ONLY. Dragging by the whole panel makes its contents unusable: every attempt to
 * select text or scroll a table becomes a window move.
 *
 * PANELS CANNOT BE LOST. Position is clamped so a panel always keeps a grabbable strip on screen. A
 * floating layout where a panel can be dragged past the edge and never retrieved is a trap, and
 * resizing the window must not strand panels outside the new bounds either.
 *
 * KEYBOARD MOVES AND RESIZES. A drag-only surface excludes anyone not using a mouse, and is painful
 * on a trackpad. Focus a header and the arrow keys move it; with shift they resize it.
 *
 * THE LAYOUT PERSISTS, AND CAN BE RESET. Persistence is the point of arranging panels, but a layout
 * that ends up broken is unrecoverable without an escape hatch.
 *
 * MOTION RESPECTS `prefers-reduced-motion`. The futuristic treatment is decoration; it must not make
 * the interface unusable for someone who cannot tolerate movement.
 */

const GRID = 8;                 // snap step: enough to align, small enough not to fight the user
const MIN_W = 280;
const MIN_H = 160;
const EDGE_KEEP = 64;           // px of a panel that must remain reachable on screen
const KEY_STEP = GRID * 2;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const snap = (v) => Math.round(v / GRID) * GRID;

/**
 * Keep a panel reachable inside `bounds`.
 *
 * Deliberately clamps the LEFT edge against `bounds.w - EDGE_KEEP` rather than against
 * `bounds.w - panel.w`: a panel wider than the viewport would otherwise be forced to a negative x and
 * jump on every resize.
 */
function containPanel(p, bounds) {
  const w = clamp(p.w, MIN_W, Math.max(MIN_W, bounds.w));
  const h = clamp(p.h, MIN_H, Math.max(MIN_H, bounds.h));
  return {
    ...p,
    w,
    h,
    x: clamp(p.x, -(w - EDGE_KEEP), Math.max(0, bounds.w - EDGE_KEEP)),
    y: clamp(p.y, 0, Math.max(0, bounds.h - 36)),   // headers stay grabbable
  };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** One floating panel. Presentational; all geometry is owned by the board. */
function Panel({
  panel, active, reduced, onFocus, onDragStart, onResizeStart,
  onCollapse, onMaximise, onClose, onPopOut, onKeyGeometry, children,
}) {
  const { id, title, x, y, w, h, collapsed, maximised, z } = panel;

  const frame = maximised
    ? { left: 0, top: 0, width: '100%', height: '100%' }
    : { left: x, top: y, width: w, height: collapsed ? 38 : h };

  return (
    <section
      role="group"
      aria-label={title}
      className={`hud-panel${active ? ' hud-panel-active' : ''}`}
      style={{
        position: 'absolute', ...frame, zIndex: z,
        display: 'flex', flexDirection: 'column',
        transition: reduced ? 'none' : 'box-shadow 140ms ease, border-color 140ms ease',
      }}
      onMouseDown={() => onFocus(id)}
    >
      {/* Header: the only drag handle, and the keyboard target. */}
      <header
        className="hud-panel-bar"
        tabIndex={0}
        role="toolbar"
        aria-label={`${title} window controls. Arrow keys move, shift and arrow keys resize.`}
        onMouseDown={(e) => onDragStart(e, id)}
        onKeyDown={(e) => onKeyGeometry(e, id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 8px', height: 38, flexShrink: 0,
          cursor: maximised ? 'default' : 'grab', userSelect: 'none',
        }}
      >
        <span aria-hidden="true" className="hud-panel-glyph">◈</span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)' }}>
          {title}
        </span>
        <span style={{ flex: 1 }} />

        {/* Real buttons, not clickable divs: they must be reachable by keyboard and screen reader. */}
        <button type="button" className="hud-panel-btn" onClick={() => onCollapse(id)}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`} title="Collapse">
          {collapsed ? '▣' : '▤'}
        </button>
        <button type="button" className="hud-panel-btn" onClick={() => onMaximise(id)}
          aria-label={maximised ? `Restore ${title}` : `Maximise ${title}`} title="Maximise">
          {maximised ? '◱' : '◻'}
        </button>
        {onPopOut && (
          <button type="button" className="hud-panel-btn" onClick={() => onPopOut(id)}
            aria-label={`Open ${title} in a separate window`} title="Pop out to its own window">
            ⧉
          </button>
        )}
        {onClose && (
          <button type="button" className="hud-panel-btn hud-panel-btn-danger"
            onClick={() => onClose(id)} aria-label={`Close ${title}`} title="Close">
            ✕
          </button>
        )}
      </header>

      {!collapsed && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 12px' }}>
          {children}
        </div>
      )}

      {/* Resize grip. Hidden when maximised, where resizing is meaningless. */}
      {!collapsed && !maximised && (
        <div
          role="separator"
          aria-label={`Resize ${title}`}
          onMouseDown={(e) => onResizeStart(e, id)}
          className="hud-panel-grip"
          style={{
            position: 'absolute', right: 0, bottom: 0, width: 18, height: 18,
            cursor: 'nwse-resize',
          }}
        />
      )}
    </section>
  );
}

/**
 * @param {object}   props
 * @param {Array}    props.panels    `[{id, title, x, y, w, h, render}]` — initial layout
 * @param {string}   [props.storageKey] persists geometry under this key
 * @param {function} [props.onPopOut]  `(panel) => void`; omit to hide the pop-out control
 */
export default function PanelBoard({ panels: initial, storageKey = null, onPopOut = null }) {
  const boardRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const [bounds, setBounds] = useState({ w: 1200, h: 800 });

  // Set once the board has been measured, so the first layout can fit the window that exists rather
  // than the one the defaults assumed.
  const laidOut = useRef(false);

  const [geo, setGeo] = useState(() => {
    const base = {};
    initial.forEach((p, i) => {
      base[p.id] = {
        id: p.id,
        title: p.title,
        x: p.x ?? (24 + (i % 2) * 520),
        y: p.y ?? (24 + Math.floor(i / 2) * 300),
        w: p.w ?? 500,
        h: p.h ?? 280,
        collapsed: false,
        maximised: false,
        closed: false,
        z: i + 1,
      };
    });

    if (storageKey && typeof localStorage !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved && typeof saved === 'object' && Object.keys(saved).length) {
          // A saved layout is master's arrangement and must not be overwritten by the responsive
          // default, so tiling is skipped entirely when one exists.
          laidOut.current = true;
        }
        if (saved && typeof saved === 'object') {
          for (const id of Object.keys(base)) {
            // Merged per key rather than replacing wholesale, so a panel added in a later version
            // still appears for a master who already has a saved layout.
            if (saved[id]) base[id] = { ...base[id], ...saved[id], title: base[id].title };
          }
        }
      } catch { /* a corrupt layout falls back to the default rather than blocking the page */ }
    }
    return base;
  });

  const [activeId, setActiveId] = useState(initial[0]?.id ?? null);
  const drag = useRef(null);

  // Measure the board, and re-contain on resize so nothing is stranded outside the new bounds.
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const b = { w: r.width, h: r.height };
      setBounds(b);

      setGeo(g => {
        const ids = Object.keys(g);

        // FIRST MEASURE WITH NO SAVED LAYOUT: tile to the window that actually exists.
        //
        // The defaults were absolute pixels — a panel at x:752 w:420 needs a 1190px board. On a
        // narrower window those panels sat past the right edge, and `containPanel` only guarantees a
        // 64px grabbable strip, so most of each panel was clipped by the board's `overflow: hidden`.
        // Master saw exactly that. Column count now follows the measured width.
        if (!laidOut.current && b.w > 0 && ids.length) {
          laidOut.current = true;
          const cols = b.w >= 1100 ? 2 : 1;
          const rows = Math.ceil(ids.length / cols);
          const gap = 12;
          const cw = Math.max(MIN_W, Math.floor((b.w - gap * (cols + 1)) / cols));
          // Height is allowed to overflow a short board — the alternative is panels too small to use,
          // and vertical overflow is recoverable by dragging whereas an unusable panel is not.
          const ch = Math.max(MIN_H, Math.floor((Math.max(b.h, 420) - gap * (rows + 1)) / rows));

          const next = {};
          ids.forEach((id, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            next[id] = containPanel({
              ...g[id],
              x: gap + col * (cw + gap),
              y: gap + row * (ch + gap),
              w: cw,
              h: ch,
            }, b);
          });
          return next;
        }

        const next = {};
        for (const [id, p] of Object.entries(g)) next[id] = containPanel(p, b);
        return next;
      });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    if (!storageKey || typeof localStorage === 'undefined') return;
    try { localStorage.setItem(storageKey, JSON.stringify(geo)); } catch { /* quota: not fatal */ }
  }, [geo, storageKey]);

  const focus = useCallback((id) => {
    setActiveId(id);
    setGeo(g => {
      const top = Math.max(...Object.values(g).map(p => p.z));
      if (g[id]?.z === top) return g;      // already on top: avoid a pointless re-render per click
      return { ...g, [id]: { ...g[id], z: top + 1 } };
    });
  }, []);

  // Pointer move/up live on `window`, not the panel: a fast drag outruns the element and the panel
  // would otherwise stick to the cursor after the button is released.
  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      setGeo(g => {
        const p = g[d.id];
        if (!p) return g;
        const moved = d.mode === 'move'
          ? { ...p, x: snap(d.ox + dx), y: snap(d.oy + dy) }
          : { ...p, w: snap(d.ow + dx), h: snap(d.oh + dy) };
        return { ...g, [d.id]: containPanel(moved, bounds) };
      });
    };
    const up = () => {
      if (drag.current) document.body.style.cursor = '';
      drag.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [bounds]);

  const onDragStart = useCallback((e, id) => {
    // Only the header background starts a drag: a click on a control must not move the window.
    if (e.target.closest('.hud-panel-btn')) return;
    const p = geo[id];
    if (!p || p.maximised) return;
    e.preventDefault();
    focus(id);
    drag.current = { id, mode: 'move', startX: e.clientX, startY: e.clientY, ox: p.x, oy: p.y };
    document.body.style.cursor = 'grabbing';
  }, [geo, focus]);

  const onResizeStart = useCallback((e, id) => {
    const p = geo[id];
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    focus(id);
    drag.current = { id, mode: 'resize', startX: e.clientX, startY: e.clientY, ow: p.w, oh: p.h };
    document.body.style.cursor = 'nwse-resize';
  }, [geo, focus]);

  /** Arrow keys move; with shift they resize. The board is unusable without a mouse otherwise. */
  const onKeyGeometry = useCallback((e, id) => {
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    setGeo(g => {
      const p = g[id];
      if (!p || p.maximised) return g;
      const next = e.shiftKey
        ? { ...p, w: p.w + d[0] * KEY_STEP, h: p.h + d[1] * KEY_STEP }
        : { ...p, x: p.x + d[0] * KEY_STEP, y: p.y + d[1] * KEY_STEP };
      return { ...g, [id]: containPanel(next, bounds) };
    });
  }, [bounds]);

  const toggle = (id, key) => setGeo(g => ({ ...g, [id]: { ...g[id], [key]: !g[id][key] } }));

  const resetLayout = useCallback(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(storageKey); } catch { /* nothing to do */ }
    }
    // Re-tile against the CURRENT bounds rather than restoring the original pixel defaults, which is
    // what master wants from "reset": a layout that fits this window, not the one it was written for.
    const cols = bounds.w >= 1100 ? 2 : 1;
    const rows = Math.ceil(initial.length / cols);
    const gap = 12;
    const cw = Math.max(MIN_W, Math.floor((bounds.w - gap * (cols + 1)) / cols));
    const ch = Math.max(MIN_H, Math.floor((Math.max(bounds.h, 420) - gap * (rows + 1)) / rows));

    setGeo(() => {
      const base = {};
      initial.forEach((p, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        base[p.id] = containPanel({
          id: p.id, title: p.title,
          x: gap + col * (cw + gap), y: gap + row * (ch + gap),
          w: cw, h: ch,
          collapsed: false, maximised: false, closed: false, z: i + 1,
        }, bounds);
      });
      return base;
    });
  }, [initial, storageKey, bounds]);

  const open = initial.filter(p => !geo[p.id]?.closed);
  const hidden = initial.filter(p => geo[p.id]?.closed);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '6px 10px', flexShrink: 0,
      }}>
        <span className="section-label">WORKSPACE</span>
        {/* Closed panels must be recoverable, or closing one is destructive. */}
        {hidden.map(p => (
          <button key={p.id} type="button" className="btn btn-sm"
            onClick={() => setGeo(g => ({ ...g, [p.id]: { ...g[p.id], closed: false } }))}
            style={{ fontSize: 11.5 }}>
            + {p.title}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          drag headers · shift+arrows resize
        </span>
        <button type="button" className="btn btn-sm" onClick={resetLayout} style={{ fontSize: 11.5 }}>
          ↺ reset layout
        </button>
      </div>

      <div ref={boardRef} className="hud-board" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {open.map(p => (
          <Panel
            key={p.id}
            panel={geo[p.id]}
            active={activeId === p.id}
            reduced={reduced}
            onFocus={focus}
            onDragStart={onDragStart}
            onResizeStart={onResizeStart}
            onCollapse={(id) => toggle(id, 'collapsed')}
            onMaximise={(id) => toggle(id, 'maximised')}
            onClose={open.length > 1 ? ((id) => toggle(id, 'closed')) : null}
            onPopOut={onPopOut ? (() => onPopOut(p)) : null}
          >
            {p.render()}
          </Panel>
        ))}
      </div>
    </div>
  );
}
