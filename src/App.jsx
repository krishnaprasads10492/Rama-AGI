import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import AppShell   from '@components/AppShell.jsx';
import ErrorBoundary from '@components/ErrorBoundary.jsx';

// Pages (lazy-loaded for performance)
const Chat      = React.lazy(() => import('@pages/Chat/Chat.jsx'));
const System    = React.lazy(() => import('@pages/System/System.jsx'));
const Terminal  = React.lazy(() => import('@pages/Terminal/Terminal.jsx'));
const GitSync   = React.lazy(() => import('@pages/GitSync/GitSync.jsx'));
const StockMind = React.lazy(() => import('@pages/StockMind/StockMind.jsx'));
const Knowledge = React.lazy(() => import('@pages/Knowledge/Knowledge.jsx'));
const Home      = React.lazy(() => import('@pages/Home/Home.jsx'));
const Agents    = React.lazy(() => import('@pages/Agents/Agents.jsx'));
const Models    = React.lazy(() => import('@pages/Models/Models.jsx'));

// Loading fallback
const PageLoader = () => (
  <div className="flex-col h-full items-center" style={{
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    height:         '100%',
    gap:            '12px',
  }}>
    <div style={{
      width:  '32px',
      height: '32px',
      border: '2px solid var(--border)',
      borderTopColor: 'var(--accent)',
      borderRadius:   '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
    <span style={{ color: 'var(--muted)', fontSize: '11px', letterSpacing: '0.1em' }}>
      LOADING MODULE...
    </span>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// Tray navigation — listens for nav:goto events from Electron tray
function TrayNavListener() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!window.rama?.nav?.onGoto) return;
    const unsub = window.rama.nav.onGoto((route) => navigate(route));
    return unsub;
  }, [navigate]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <TrayNavListener />
      <ErrorBoundary>
        <AppShell>
          <React.Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/"           element={<Chat />} />
              <Route path="/home"       element={<Home />} />
              <Route path="/system"     element={<System />} />
              <Route path="/terminal"   element={<Terminal />} />
              <Route path="/git"        element={<GitSync />} />
              <Route path="/stockmind"  element={<StockMind />} />
              <Route path="/knowledge"  element={<Knowledge />} />
              <Route path="/agents"     element={<Agents />} />
              <Route path="/models"     element={<Models />} />
              {/* Catch-all → Chat */}
              <Route path="*"           element={<Chat />} />
            </Routes>
          </React.Suspense>
        </AppShell>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
