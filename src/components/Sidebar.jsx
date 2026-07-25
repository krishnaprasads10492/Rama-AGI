import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  { route: '/',           icon: '◈',  label: 'Chat',       color: 'var(--violet)',  title: 'Rāma AGI Chat' },
  { route: '/home',       icon: '⬡',  label: 'Home',       color: 'var(--accent)',  title: 'Dashboard' },
  { route: '/system',     icon: '⬢',  label: 'System',     color: 'var(--green)',   title: 'System Monitor' },
  { route: '/terminal',   icon: '>_', label: 'Terminal',   color: 'var(--green)',   title: 'Embedded Terminal' },
  { route: '/git',        icon: '⎇',  label: 'Git Sync',   color: 'var(--amber)',   title: 'Git Sync Bridge' },
  { route: '/agents',     icon: '◎',  label: 'Agents',     color: 'var(--violet)',  title: 'Multi-Agent Control' },
  { route: '/models',     icon: '⋯',  label: 'Models',     color: 'var(--accent)',  title: 'AI Model Router' },
  { route: '/stockmind',  icon: '◬',  label: 'StockMind',  color: 'var(--magenta)', title: 'StockMind AI' },
  { route: '/knowledge',  icon: '◉',  label: 'Knowledge',  color: 'var(--accent)',  title: 'Knowledge Base' },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate  = useNavigate();
  const [expanded, setExpanded] = useState(false);

  return (
    <nav
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        width:        expanded ? 'var(--sidebar-exp)' : 'var(--sidebar-w)',
        minWidth:     expanded ? 'var(--sidebar-exp)' : 'var(--sidebar-w)',
        height:       '100%',
        background:   'var(--surface)',
        borderRight:  '1px solid var(--border)',
        display:      'flex',
        flexDirection: 'column',
        alignItems:   expanded ? 'stretch' : 'center',
        padding:      '8px 0',
        gap:          '2px',
        transition:   'width var(--transition-slow), min-width var(--transition-slow)',
        overflow:     'hidden',
        flexShrink:   0,
        position:     'relative',
        zIndex:       100,
      }}
    >
      {/* Glow trail on expand */}
      {expanded && (
        <div style={{
          position:   'absolute',
          right:      0,
          top:        0,
          bottom:     0,
          width:      '1px',
          background: 'linear-gradient(180deg, transparent, var(--accent), transparent)',
          opacity:    0.5,
          animation:  'data-stream 2s ease infinite',
        }} />
      )}

      {/* Nav items */}
      {NAV_ITEMS.map((item) => {
        const active = location.pathname === item.route ||
                       (item.route !== '/' && location.pathname.startsWith(item.route));
        return (
          <NavItem
            key={item.route}
            item={item}
            active={active}
            expanded={expanded}
            onClick={() => navigate(item.route)}
          />
        );
      })}

      {/* Bottom — Rāma orb indicator */}
      <div style={{ flex: 1 }} />
      <div style={{
        padding:    '8px',
        display:    'flex',
        alignItems: 'center',
        gap:        '8px',
        justifyContent: expanded ? 'flex-start' : 'center',
        paddingLeft: expanded ? '12px' : '8px',
      }}>
        <OrbMini />
        {expanded && (
          <span style={{
            fontSize:  '10px',
            color:     'var(--violet)',
            letterSpacing: '0.1em',
            whiteSpace: 'nowrap',
          }}>
            RĀMA ONLINE
          </span>
        )}
      </div>
    </nav>
  );
}

function NavItem({ item, active, expanded, onClick }) {
  const [hover, setHover] = useState(false);
  const highlighted = active || hover;

  return (
    <button
      onClick={onClick}
      title={!expanded ? item.title : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display:     'flex',
        alignItems:  'center',
        gap:         '10px',
        padding:     expanded ? '9px 12px' : '9px',
        margin:      '0 6px',
        border:      'none',
        borderRadius: 'var(--radius)',
        background:  active
          ? `rgba(${hexToRgb(item.color)}, 0.1)`
          : hover
          ? 'rgba(0,255,255,0.04)'
          : 'transparent',
        borderLeft:  active ? `2px solid ${item.color}` : '2px solid transparent',
        cursor:      'pointer',
        transition:  'all var(--transition)',
        whiteSpace:  'nowrap',
        overflow:    'hidden',
        minWidth:    0,
        boxShadow:   active ? `inset 0 0 20px ${item.color}11` : 'none',
        justifyContent: expanded ? 'flex-start' : 'center',
      }}
    >
      <span style={{
        fontSize:   '16px',
        color:      highlighted ? item.color : 'var(--muted)',
        textShadow: highlighted ? `0 0 8px ${item.color}` : 'none',
        transition: 'all var(--transition)',
        minWidth:   '20px',
        textAlign:  'center',
        flexShrink: 0,
      }}>
        {item.icon}
      </span>

      {expanded && (
        <span style={{
          fontSize:      '12px',
          fontWeight:    active ? 700 : 400,
          color:         active ? item.color : hover ? 'var(--text)' : 'var(--text-dim)',
          letterSpacing: '0.05em',
          transition:    'color var(--transition)',
        }}>
          {item.label}
        </span>
      )}
    </button>
  );
}

function OrbMini() {
  return (
    <div style={{ position: 'relative', width: '20px', height: '20px', flexShrink: 0 }}>
      <div style={{
        position:     'absolute',
        inset:        '4px',
        borderRadius: '50%',
        background:   'radial-gradient(circle, var(--violet), #330066)',
        boxShadow:    'var(--glow-violet)',
        animation:    'pulse-ring 2.5s ease infinite',
      }} />
      <div style={{
        position:     'absolute',
        inset:        0,
        borderRadius: '50%',
        border:       '1px solid var(--violet)',
        opacity:      0.4,
        animation:    'pulse-ring 2.5s ease infinite 0.5s',
      }} />
    </div>
  );
}

// Helper: CSS color var to RGB triplet for rgba()
function hexToRgb(cssVar) {
  const map = {
    'var(--violet)':  '119,0,255',
    'var(--accent)':  '0,255,255',
    'var(--green)':   '0,255,65',
    'var(--magenta)': '255,0,170',
    'var(--amber)':   '255,170,0',
    'var(--red)':     '255,0,60',
  };
  return map[cssVar] || '0,255,255';
}
