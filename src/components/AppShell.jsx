import React from 'react';
import Titlebar from './Titlebar.jsx';
import Sidebar  from './Sidebar.jsx';

/**
 * AppShell — Master layout for all pages.
 * Structure: Titlebar (top) | Sidebar (left) + Content (right fill)
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

      {/* Body: sidebar + main content */}
      <div style={{
        display:  'flex',
        flex:     1,
        overflow: 'hidden',
        minHeight: 0,
      }}>
        <Sidebar />

        {/* Main content area */}
        <main style={{
          flex:           1,
          overflow:       'hidden',
          display:        'flex',
          flexDirection:  'column',
          minWidth:       0,
          position:       'relative',
          background:     'var(--bg)',
        }}
          // Subtle cyan grid on main area
          className="grid-bg"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
