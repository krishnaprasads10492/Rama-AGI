import React, { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import AppShell      from '@components/AppShell.jsx';
import ErrorBoundary from '@components/ErrorBoundary.jsx';
import { useAppStore }  from '@store/appStore.js';
import { useUserStore } from '@store/userStore.js';
import { startConsciousnessLoop, stopConsciousnessLoop, authenticateMaster } from '@services/consciousness.js';
import { loadSession, saveSession, instanceApi } from '@services/authClient.js';
import { TIERS } from '@services/accessControl.js';
import Login   from '@pages/Login/Login.jsx';
import Setup   from '@pages/Setup/Setup.jsx';
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

/**
 * App — the gate chain.
 *
 *   Gate 1  passcode  → Unlock.jsx      decrypts the store
 *   Setup             → Setup.jsx       only when this copy has no owner yet
 *   Gate 2+3          → Login.jsx       password, then 12-digit access key
 *   then              → the app
 *
 * Each gate is a hard boundary: the next one cannot be reached or inspected
 * until the previous has actually passed. Provisioning is asked of the store,
 * never assumed, so a build handed to someone else configures itself in the UI
 * and they never open the source.
 */
export default function App() {
  const { currentUser, setSession } = useUserStore();
  const [authChecked,    setAuthChecked]    = useState(false);
  const [cryptoUnlocked, setCryptoUnlocked] = useState(false);
  const [instanceInfo,   setInstanceInfo]   = useState(null);   // null = not asked yet
  const [setupDone,      setSetupDone]      = useState(false);

  // Restore an existing session, if the tab still holds one
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

  // Ask the store whether this copy has an owner. Only meaningful post-unlock.
  const refreshInstanceInfo = useCallback(async () => {
    const res = await instanceApi.info();
    setInstanceInfo(res?.ok ? res.data : { provisioned: false, unreachable: true });
  }, []);

  useEffect(() => {
    if (cryptoUnlocked) refreshInstanceInfo();
  }, [cryptoUnlocked, refreshInstanceInfo]);

  if (!authChecked) return null;

  // ── Gate 1 — passcode unlocks the encrypted store ────────────────────────
  if (!cryptoUnlocked) {
    return (
      <Unlock onUnlocked={(result) => {
        // Browser dev mode: no store to open, so fall straight through
        if (result.devMode) { setCryptoUnlocked(true); return; }

        // The session manager may hand back an already-authenticated user
        if (result.user) {
          saveSession(result.token, result.user);
          setSession(result.user, result.token);
          if (result.user.tier === TIERS.MASTER) authenticateMaster(true);
        }
        setCryptoUnlocked(true);
      }} />
    );
  }

  // Waiting on the store's answer — render nothing rather than guess a gate
  if (instanceInfo === null) return null;

  // ── First run — provision this instance's owner ──────────────────────────
  if (!instanceInfo.provisioned && !setupDone && !instanceInfo.browserOnly) {
    return (
      <Setup onProvisioned={async () => {
        setSetupDone(true);
        await refreshInstanceInfo();
      }} />
    );
  }

  // ── Gates 2 and 3 — password, then access key ────────────────────────────
  if (!currentUser) {
    return (
      <div style={{ fontFamily: 'var(--font)' }}>
        <Login onLogin={() => { /* setSession already ran inside Login */ }} />
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
