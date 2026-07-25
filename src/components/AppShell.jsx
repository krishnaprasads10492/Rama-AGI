import React, { useState } from 'react';
import Titlebar       from './Titlebar.jsx';
import CommandPalette from './CommandPalette.jsx';
import ActivityStream from './ActivityStream.jsx';

export default function AppShell({ children }) {
  const [streamVisible, setStreamVisible] = useState(false);

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100vh',
      width:         '100vw',
      overflow:      'hidden',
      background:    'var(--bg)',
    }}>
      <Titlebar />
      <CommandPalette />
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

      {/* Live activity stream — floating overlay */}
      <ActivityStream
        visible={streamVisible}
        onToggle={() => setStreamVisible(v => !v)}
      />
    </div>
  );
}
