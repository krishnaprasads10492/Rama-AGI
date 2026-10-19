import React, { useCallback, useEffect, useState } from 'react';
import { FS } from '@config/type.js';
import { can } from '@services/accessControl.js';
import { visibleTo, mayWrite, pickKiteAccount, whyCannotKiteFetch, kiteFetchMessage } from '../Models/brokerAccountsModel.js';

/**
 * KiteFetch - pull candles from Zerodha Kite into the store (spec Section 156).
 *
 * Shown only to an account that holds brokers.accounts.write (SuperAdmin) AND only when a Zerodha account is
 * registered; everyone else sees nothing. It is a click, never automatic. The result is KEPT for analysis, like
 * "Fetch & keep", and says so: Kite candles feed the same working store that strategies and training read.
 * The access token never reaches this component; the reply carries counts only.
 */

const inBridge = typeof window !== 'undefined' && !!window.rama?.kiteSession && !!window.rama?.brokerAccounts;

export default function KiteFetch({ currentUser, symbol, exchange, interval, fromDate, toDate, onDone }) {
  const allowed = visibleTo(can, currentUser) && mayWrite(can, currentUser);
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const res = await window.rama.brokerAccounts.list();
    if (res?.ok === false) { setAccount(null); return; }
    setAccount(pickKiteAccount(res.data));
  }, []);

  useEffect(() => { if (allowed && inBridge) load(); }, [allowed, load, currentUser]);

  if (!allowed || !inBridge || !account) return null;

  const why = whyCannotKiteFetch({ account, symbol, interval, busy });

  const run = async () => {
    setBusy(true);
    setMessage(null);
    const res = await window.rama.kiteSession.fetchBars({
      accountId: account.id, symbol, exchange, interval, fromDate: fromDate || null, toDate: toDate || null,
    });
    setBusy(false);
    setMessage(kiteFetchMessage(res));
    if (res?.needsLogin) await load();
    if (res?.ok && onDone) onDone();
  };

  return (
    <>
      <button type="button" className="btn" disabled={!!why} onClick={run}
              title={why || 'Fetch candles for this instrument from your Zerodha Kite account and keep them for analysis. Uses your Kite data subscription.'}>
        {busy ? 'Fetching from Kite…' : '⇩ Fetch from Kite'}
      </button>
      {message && <span role="status" style={{ fontSize: FS.dense, color: 'var(--muted)', maxWidth: '60ch' }}>{message}</span>}
    </>
  );
}
