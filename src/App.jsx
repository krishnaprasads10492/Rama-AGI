import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
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

// Every page/route/tier comes from ONE registry — src/config/registry.js
import { routablePages, visiblePages, lazyFor, registryIssues } from '@config/registry.js';

const Chat = lazyFor('chat');

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

// Access denied panel — shown when a route exists but the tier is too low
const Forbidden = ({ page }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', gap: '10px', textAlign: 'center',
  }}>
    <span style={{ fontSize: '32px', color: 'var(--red)' }}>⛔</span>
    <div style={{ color: 'var(--text)', fontSize: '14px', fontWeight: 700 }}>
      Access restricted
    </div>
    <div style={{ color: 'var(--muted)', fontSize: '11px', maxWidth: '320px' }}>
      {page?.label ?? 'This module'} requires a higher access tier.
      Rāma will not expose it to the current session.
    </div>
  </div>
);

/**
 * Routes generated from the registry. A route is always mounted so deep links
 * resolve, but the element is gated on tier — nothing leaks by URL guessing.
 */
function RegistryRoutes({ user }) {
  const allowed = new Set(visiblePages(user).map(p => p.route));
  return (
    <Routes>
      {routablePages().map((page) => {
        const Component = lazyFor(page.id);
        return (
          <Route
            key={page.id}
            path={page.route}
            element={allowed.has(page.route) ? <Component /> : <Forbidden page={page} />}
          />
        );
      })}
      {/* Catch-all → Chat (available to every tier) */}
      <Route path="*" element={<Chat />} />
    </Routes>
  );
}

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

/**
 * Instance lattice bootstrap. Runs once the encrypted store is unlocked and a
 * user is present: restores persisted instances, then guarantees a prime
 * instance exists so Rāma is always available to its master.
 */
function InstanceProvider() {
  const { pushNotification } = useAppStore();

  useEffect(() => {
    if (!window.rama?.instance) return;
    let cancelled = false;

    (async () => {
      try {
        await window.rama.instance.restore();
        const res = await window.rama.instance.ensurePrime();
        if (cancelled) return;
        if (res?.created) {
          pushNotification({ type: 'info', message: 'Prime instance active — full genome expressed', duration: 5000 });
        } else if (res?.ok === false) {
          pushNotification({ type: 'warn', message: `Instance bootstrap: ${res.error}`, duration: 8000 });
        }
      } catch (err) {
        console.warn('[instances] bootstrap failed:', err.message);
      }
    })();

    return () => { cancelled = true; };
  }, [pushNotification]);

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

  // Registry integrity — a page defined without a loader would silently 404
  useEffect(() => {
    const issues = registryIssues();
    if (issues.length) console.warn('[registry]', issues.join('; '));
  }, []);

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
      <InstanceProvider />
      <ErrorBoundary>
        <AppShell>
          <React.Suspense fallback={<PageLoader />}>
            <RegistryRoutes user={currentUser} />
          </React.Suspense>
        </AppShell>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
