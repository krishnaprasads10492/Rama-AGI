import React from 'react';
import Titlebar      from './Titlebar.jsx';
import CommandPalette from './CommandPalette.jsx';

/**
 * AppShell — Master layout.
 * No sidebar. Navigation via Command Palette (Ctrl+K, voice, orb click).
 *
 * Structure:
 *   Titlebar (always visible)
 *   CommandPalette (collapsible via Ctrl+K / orb / voice)
 *   ─── 3px glow strip toggle ───
 *   Active Page (full width, full remaining height)
 */
export default function AppShell({ children }) {
  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100vh',
      width:         '100vw',
      overflow:      'hidden',
      background:    'var(--bg)',
    }}>
      {/* Custom frameless titlebar */}
      <Titlebar />

      {/* Command palette — slides open/closed, contains all nav tabs */}
      <CommandPalette />

      {/* Main content — full width, no sidebar */}
      <main
        className="grid-bg"
        style={{
          flex:          1,
          overflow:      'hidden',
          display:       'flex',
          flexDirection: 'column',
          minWidth:      0,
          minHeight:     0,
          position:      'relative',
          background:    'var(--bg)',
        }}
      >
        {children}
      </main>
    </div>
  );
}
