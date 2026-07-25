import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import AppShell      from '@components/AppShell.jsx';
import ErrorBoundary from '@components/ErrorBoundary.jsx';
import { useUIStore }   from '@store/uiStore.js';
import { useAppStore }  from '@store/appStore.js';
import { useUserStore } from '@store/userStore.js';
import { startConsciousnessLoop, stopConsciousnessLoop } from '@services/consciousness.js';
import { loadSession, authApi, saveSession } from '@services/authClient.js';
import { authenticateMaster } from '@services/consciousness.js';
import { TIERS } from '@services/accessControl.js';
import Login   from '@pages/Login/Login.jsx';
import Unlock  from '@pages/Unlock/Unlock.jsx';

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
const RamaMind     = React.lazy(() => import('@pages/RamaMind/RamaMind.jsx'));
const Users        = React.lazy(() => import('@pages/Users/Users.jsx'));
const Intelligence = React.lazy(() => import('@pages/Intelligence/Intelligence.jsx'));
const IDE          = React.lazy(() => import('@pages/IDE/IDE.jsx'));
const Evolution    = React.lazy(() => import('@pages/Evolution/Evolution.jsx'));
const Resources    = React.lazy(() => import('@pages/Resources/Resources.jsx'));

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

// Consciousness loop — starts on app load
function ConsciousnessProvider() {
  const { setLastHealthCheck, pushNotification } = useAppStore();

  useEffect(() => {
    startConsciousnessLoop({
      onHealth: (health) => setLastHealthCheck(health),
      onAlert:  (alert)  => pushNotification({
        type:    alert.level,
        message: alert.msg,
        duration: 8000,
      }),
    });
    return () => stopConsciousnessLoop();
  }, []);

  return null;
}

export default function App() {
  const { currentUser, setSession } = useUserStore();
  const [authChecked,    setAuthChecked]    = useState(false);
  const [cryptoUnlocked, setCryptoUnlocked] = useState(false);

  // Step 1: Check & restore session
  useEffect(() => {
    const existing = loadSession();
    if (existing) {
      setSession(existing.user, existing.token);
      if (existing.user?.tier === TIERS.MASTER) authenticateMaster(true);
    }
    setAuthChecked(true);
  }, [setSession]);

  if (!authChecked) return null;

  // Step 1: Crypto unlock gate — always first
  if (!cryptoUnlocked) {
    return (
      <Unlock onUnlocked={(result) => {
        if (result.devMode) {
          // Browser dev mode — skip crypto, show login
          setCryptoUnlocked(true);
          return;
        }
        // In Electron, session manager returned user after unlock
        if (result.user) {
          saveSession(result.token, result.user);
          setSession(result.user, result.token);
          if (result.user.tier === TIERS.MASTER) authenticateMaster(true);
        }
        setCryptoUnlocked(true);
      }} />
    );
  }

  // Step 2: User login gate (for non-master accounts)
  if (!currentUser) {
    return (
      <div style={{ fontFamily: 'var(--font)' }}>
        <Login onLogin={() => {}} />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <TrayNavListener />
      <ConsciousnessProvider />
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
              <Route path="/mind"       element={<RamaMind />} />
              <Route path="/users"      element={<Users />} />
              <Route path="/intel"      element={<Intelligence />} />
              <Route path="/ide"        element={<IDE />} />
              <Route path="/evolution"  element={<Evolution />} />
              <Route path="/resources"  element={<Resources />} />
              {/* Catch-all → Chat */}
              <Route path="*"           element={<Chat />} />
            </Routes>
          </React.Suspense>
        </AppShell>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
