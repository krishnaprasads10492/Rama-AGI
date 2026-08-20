import React, { useEffect, useState, useCallback } from 'react';
import { systemClient }  from '@services/ipcClient.js';
import { formatBytes }   from '@services/ramaClient.js';
import { useUserStore }  from '@store/userStore.js';

// ─── Gauge bar ────────────────────────────────────────────────────────────────
function GaugeBar({ value, max = 100, color = 'var(--accent)', height = 6 }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const c   = pct > 85 ? 'var(--red)' : pct > 65 ? 'var(--amber)' : color;
  return (
    <div style={{ width: '100%', height, background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
      <div style={{
        width:      `${pct}%`,
        height:     '100%',
        background: c,
        boxShadow:  `0 0 6px ${c}88`,
        transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────
function MetricCard({ icon, label, value, sub, bar, barValue, color = 'var(--accent)' }) {
  return (
    <div className="hud-card" style={{ padding: '16px', minWidth: '160px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ color: 'var(--muted)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: '16px' }}>{icon}</span>
      </div>
      <div style={{ fontSize: '24px', fontWeight: 700, color, marginBottom: '4px' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{sub}</div>}
      {bar && <div style={{ marginTop: '10px' }}><GaugeBar value={barValue} color={color} /></div>}
    </div>
  );
}

// ─── Process row ──────────────────────────────────────────────────────────────
function ProcessRow({ proc, onKill }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '6px 10px', color: 'var(--text-dim)', fontSize: '11px' }}>{proc.pid}</td>
      <td style={{ padding: '6px 10px', color: 'var(--text)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proc.name}</td>
      <td style={{ padding: '6px 10px', color: proc.cpu > 20 ? 'var(--amber)' : 'var(--text-dim)', textAlign: 'right' }}>{proc.cpu}%</td>
      <td style={{ padding: '6px 10px', color: proc.mem > 500 ? 'var(--amber)' : 'var(--text-dim)', textAlign: 'right' }}>{proc.mem} MB</td>
      <td style={{ padding: '6px 10px' }}>
        {!confirm
          ? <button className="btn btn-sm btn-danger" onClick={() => setConfirm(true)}>Kill</button>
          : (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="btn btn-sm btn-danger" onClick={() => { onKill(proc.pid); setConfirm(false); }}>Confirm</button>
              <button className="btn btn-sm" onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          )
        }
      </td>
    </tr>
  );
}

// ─── Rāma's own footprint — separate from total machine usage ────────────────
// Master asked for the difference between total system load and what Rāma
// itself accounts for, foreground and background. This panel is the answer:
// real per-process figures from Electron's own app.getAppMetrics() (main,
// every window, GPU, utility) plus Rāma's external child processes (Python
// backend, open terminals, the Playwright browser) looked up by PID — never
// an estimate, and a process whose PID has already exited is shown as
// "not found" rather than silently dropped.
function RamaFootprintPanel() {
  const [footprint, setFootprint] = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      const res = await systemClient.getOwnFootprint().catch(err => ({ ok: false, error: err.message }));
      if (!stopped && res?.ok) setFootprint(res.data);
      setLoading(false);
      if (!stopped) setTimeout(loop, 5000);
    };
    loop();
    return () => { stopped = true; };
  }, []);

  if (loading && !footprint) {
    return <div style={{ color: 'var(--muted)', fontSize: '11px' }}>Reading Rāma's own footprint...</div>;
  }
  if (!footprint) return null;

  const byType = {};
  for (const p of footprint.processes) {
    const key = p.source === 'electron' ? p.type : p.label;
    byType[key] = byType[key] || { cpuPct: 0, memKB: 0, count: 0, allFound: true };
    byType[key].cpuPct += p.cpuPct || 0;
    byType[key].memKB  += p.memKB || 0;
    byType[key].count  += 1;
    if (p.found === false) byType[key].allFound = false;
  }

  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div className="section-label">RĀMA'S OWN FOOTPRINT</div>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
          {footprint.totals.cpuPct}% CPU · {formatBytes(footprint.totals.memMB * 1024 * 1024)} RAM
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.6 }}>
        {footprint.note}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {Object.entries(byType).map(([label, v]) => (
          <div key={label} style={{ padding: '8px 10px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {label} {v.count > 1 ? `(${v.count})` : ''}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: v.allFound ? 'var(--accent)' : 'var(--amber)', marginTop: 2 }}>
              {v.allFound ? `${v.cpuPct.toFixed(1)}% · ${formatBytes(v.memKB * 1024)}` : 'process exited'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Temp cleaner modal ───────────────────────────────────────────────────────
function TempCleaner({ onClose }) {
  const { currentUser } = useUserStore();
  const [targets,  setTargets]  = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading,  setLoading]  = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [results,  setResults]  = useState(null);

  useEffect(() => {
    systemClient.getTempTargets().then(res => {
      if (res.ok) {
        setTargets(res.data);
        // Safe temp/cache dirs are pre-selected; anything flagged `risky`
        // (browser caches that can sign the user out, even though they no
        // longer point at login/history data) starts unchecked — cleaning
        // those needs a deliberate click, not a side effect of "Clean N targets".
        setSelected(new Set(res.data.filter(t => !t.risky).map(t => t.path)));
      }
      setLoading(false);
    });
  }, []);

  const clean = async () => {
    setCleaning(true);
    const paths = targets.filter(t => selected.has(t.path)).map(t => t.path);
    const res   = await systemClient.cleanTemp(currentUser, paths);
    if (res.ok) setResults(res.data);
    setCleaning(false);
  };

  const toggle = (path) => {
    const s = new Set(selected);
    if (s.has(path)) s.delete(path); else s.add(path);
    setSelected(s);
  };

  const totalBytes = targets
    .filter(t => selected.has(t.path))
    .reduce((a, t) => a + (t.sizeBytes || 0), 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500,
    }}>
      <div className="hud-card" style={{ width: '560px', maxHeight: '70vh', display: 'flex', flexDirection: 'column', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.08em' }}>SYSTEM CLEANER</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        {loading && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>Scanning...</div>}

        {!loading && !results && (
          <>
            <div style={{ overflowY: 'auto', flex: 1, marginBottom: '16px' }}>
              {targets.map(t => (
                <div key={t.id} onClick={() => toggle(t.path)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 10px', cursor: 'pointer', borderRadius: 'var(--radius)',
                    background: selected.has(t.path) ? 'rgba(0,255,255,0.05)' : 'transparent',
                    marginBottom: '2px', border: `1px solid ${selected.has(t.path) ? 'rgba(0,255,255,0.2)' : 'transparent'}`,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div style={{
                      width: '14px', height: '14px', borderRadius: '2px', flexShrink: 0,
                      border: `1px solid ${selected.has(t.path) ? 'var(--accent)' : 'var(--border)'}`,
                      background: selected.has(t.path) ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '9px', color: 'var(--bg)',
                    }}>
                      {selected.has(t.path) && '✓'}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: '12px' }}>{t.label}</span>
                      {t.risky && (
                        <div style={{ fontSize: '10px', color: 'var(--amber)', marginTop: '2px' }}>
                          ⚠ {t.note || 'May affect saved logins or sessions — not selected by default.'}
                        </div>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--amber)', flexShrink: 0, marginLeft: '10px' }}>
                    {t.sizeBytes > 0 ? formatBytes(t.sizeBytes) : '—'}
                    {t.fileCount > 0 ? ` (${t.fileCount} files)` : ''}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--amber)' }}>
                Selected: {formatBytes(totalBytes)} to free
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-sm" onClick={onClose}>Cancel</button>
                <button className="btn btn-sm btn-danger" disabled={cleaning || selected.size === 0} onClick={clean}>
                  {cleaning ? 'Cleaning...' : `Clean ${selected.size} targets`}
                </button>
              </div>
            </div>
          </>
        )}

        {results && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {results.map((r, i) => (
              <div key={i} style={{
                padding: '8px 10px', marginBottom: '4px', borderRadius: 'var(--radius)',
                background: r.ok ? 'rgba(0,255,65,0.05)' : 'rgba(255,0,60,0.05)',
                border: `1px solid ${r.ok ? 'rgba(0,255,65,0.2)' : 'rgba(255,0,60,0.2)'}`,
              }}>
                <div style={{ fontSize: '11px', color: r.ok ? 'var(--green)' : 'var(--red)' }}>
                  {r.ok ? `✓ ${r.path} — freed ${formatBytes(r.freedBytes)}` : `✕ ${r.path} — ${r.error}`}
                </div>
              </div>
            ))}
            <button className="btn btn-primary btn-sm" style={{ marginTop: '12px' }} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main System page ─────────────────────────────────────────────────────────
export default function System() {
  const { currentUser } = useUserStore();
  const [metrics,    setMetrics]   = useState(null);
  const [processes,  setProcesses] = useState([]);
  const [showCleaner, setShowCleaner] = useState(false);
  const [tab, setTab]              = useState('overview');
  const [filter, setFilter]        = useState('');
  const [error, setError]          = useState('');

  const load = useCallback(async () => {
    // Every result is treated as possibly absent: an unregistered channel resolves
    // to undefined, and `mRes.ok` on undefined throws inside this async function,
    // which surfaces as an unhandled rejection with no explanation on screen.
    const [mRes, pRes] = await Promise.all([
      systemClient.getMetrics().catch(err => ({ ok: false, error: err.message })),
      systemClient.getProcesses(currentUser).catch(err => ({ ok: false, error: err.message })),
    ]);

    if (mRes?.ok && mRes.data) {
      setMetrics(mRes.data);
      setError('');
    } else {
      // systeminformation is an optional dependency — say so rather than hang
      setError(mRes?.error ?? 'System metrics unavailable — is `systeminformation` installed?');
    }

    if (pRes?.ok && Array.isArray(pRes.data)) setProcesses(pRes.data);
  }, [currentUser]);

  useEffect(() => {
    // Self-paced polling, not a fixed setInterval: on a machine where a
    // metrics call takes longer than the poll interval (observed several
    // seconds per systeminformation call without a persistent PowerShell
    // session — see electron/lib/sysinfo.cjs), a fixed timer fires the next
    // call before the previous one returns. Calls pile up, results arrive
    // out of order, and the numbers on screen stop reflecting reality. This
    // schedules the next poll only after the current one finishes.
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      await load();
      if (!stopped) setTimeout(loop, 5000);
    };
    loop();
    return () => { stopped = true; };
  }, [load]);

  const killProcess = useCallback(async (pid) => {
    await systemClient.killProcess(currentUser, pid);
    setTimeout(load, 800);
  }, [load, currentUser]);

  // `p.name` can be absent for some OS processes; `p.name.toLowerCase()` then
  // throws during render, which used to take the whole shell down with it.
  const needle = filter.toLowerCase();
  const filteredProcs = processes.filter((p) => {
    if (!needle) return true;
    return String(p?.name ?? '').toLowerCase().includes(needle)
        || String(p?.pid ?? '').includes(needle);
  });

  /**
   * Normalise the metrics snapshot. Every field below is dereferenced during
   * render, and a partial snapshot — one `systeminformation` call failing on a
   * given platform — would otherwise throw rather than degrade.
   */
  const m = metrics && {
    ...metrics,
    cpu:     { usage: 0, cores: [], temp: null, ...(metrics.cpu ?? {}) },
    ram:     { total: 0, used: 0, usedPct: 0, swapUsed: 0, swapTotal: 0, ...(metrics.ram ?? {}) },
    gpu:     Array.isArray(metrics.gpu) ? metrics.gpu : [],
    network: Array.isArray(metrics.network) ? metrics.network : [],
    os:      { platform: 'unknown', release: '', arch: '', hostname: '', uptime: 0, ...(metrics.os ?? {}) },
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {showCleaner && <TempCleaner onClose={() => setShowCleaner(false)} />}

      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--green)', letterSpacing: '0.1em' }}>SYSTEM MONITOR</div>
          <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
            {m ? `${m.os.platform} · ${m.os.hostname} · up ${m.os.uptime}s` : 'Loading...'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={load}>↺ Refresh</button>
          <button className="btn btn-sm btn-danger" onClick={() => setShowCleaner(true)}>🧹 Clean System</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['overview', 'processes', 'network', 'disk'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 18px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font)', letterSpacing: '0.08em',
            textTransform: 'uppercase', transition: 'color var(--transition)',
          }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>
        {error && (
          <div className="hud-card" style={{
            padding: '12px 16px', marginBottom: '16px',
            borderColor: 'var(--amber)', color: 'var(--amber)', fontSize: '11px', lineHeight: 1.7,
          }}>
            {error}
            <div style={{ color: 'var(--muted)', marginTop: '6px' }}>
              OS sensing is an optional capability. Everything else in Rāma keeps working;
              install the dependency and press Refresh to restore it.
            </div>
          </div>
        )}

        {!m && !error && (
          <div style={{ color: 'var(--muted)', fontSize: '11px' }}>Reading system metrics...</div>
        )}

        {tab === 'overview' && m && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
              <MetricCard icon="⬢" label="CPU" value={`${m.cpu.usage}%`}
                sub={m.cpu.temp ? `${m.cpu.temp}°C` : 'Temp N/A'} bar barValue={m.cpu.usage} color="var(--accent)" />
              <MetricCard icon="◈" label="RAM" value={`${m.ram.usedPct}%`}
                sub={`${formatBytes(m.ram.used)} / ${formatBytes(m.ram.total)}`} bar barValue={m.ram.usedPct} color="var(--violet)" />
              {m.gpu[0] && (
                <MetricCard icon="▣" label="GPU" value={`${m.gpu[0].usage ?? '?'}%`}
                  sub={m.gpu[0].model} bar barValue={m.gpu[0].usage || 0} color="var(--magenta)" />
              )}
              <MetricCard icon="↕" label="Network"
                value={`${formatBytes(m.network[0]?.rxSec || 0)}/s`}
                sub={`↑ ${formatBytes(m.network[0]?.txSec || 0)}/s`} color="var(--green)" />
            </div>

            <RamaFootprintPanel />

            {/* CPU cores */}
            {Array.isArray(m.cpu.cores) && m.cpu.cores.length > 0 && (
              <div className="hud-card" style={{ padding: '16px' }}>
                <div className="section-label" style={{ marginBottom: '12px' }}>CPU CORES</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' }}>
                  {m.cpu.cores.map((c, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '4px' }}>C{i}</div>
                      <GaugeBar value={c} color={c > 80 ? 'var(--red)' : 'var(--accent)'} height={4} />
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '3px' }}>{c}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* OS Info */}
            <div className="hud-card" style={{ padding: '16px' }}>
              <div className="section-label" style={{ marginBottom: '12px' }}>SYSTEM INFO</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  ['Platform', m.os.platform],
                  ['OS', `${m.os.distro || ''} ${m.os.release}`],
                  ['Architecture', m.os.arch],
                  ['Hostname', m.os.hostname],
                  ['Battery', m.battery ? `${m.battery.percent}% ${m.battery.charging ? '⚡' : ''}` : 'N/A'],
                  ['Swap', `${formatBytes(m.ram.swapUsed)} / ${formatBytes(m.ram.swapTotal)}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '11px' }}>{k}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'processes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input className="input" placeholder="Filter by name or PID..." value={filter}
              onChange={e => setFilter(e.target.value)} style={{ maxWidth: '320px' }} />
            <div className="hud-card" style={{ overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['PID', 'Name', 'CPU', 'Memory', 'Action'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', fontSize: '10px', color: 'var(--muted)',
                        letterSpacing: '0.1em', textAlign: h === 'CPU' || h === 'Memory' ? 'right' : 'left',
                        textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredProcs.map(p => (
                    <ProcessRow key={p.pid} proc={p} onKill={killProcess} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'network' && m && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div className="section-label" style={{ marginBottom: '12px' }}>NETWORK INTERFACES</div>
            {m.network.map((n, i) => (
              <div key={i} style={{ padding: '10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text)' }}>{n.iface}</span>
                <span style={{ color: 'var(--green)', fontSize: '12px' }}>↓ {formatBytes(n.rxSec || 0)}/s  ↑ {formatBytes(n.txSec || 0)}/s</span>
              </div>
            ))}
          </div>
        )}

        {/* Deliberately NOT gated on `m`. The disk panel calls
            system:get-disk-usage, which has nothing to do with the metrics
            snapshot — but it used to be rendered behind `m &&`, so a failing
            metrics call made the entire disk tab vanish: no card, no label, not
            even its own loading text. Clicking DISK showed empty space, which is
            what master reported. Each panel now stands or falls on its own call. */}
        {tab === 'disk' && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div className="section-label" style={{ marginBottom: '12px' }}>DISK USAGE</div>
            <DiskPanel />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Drive usage.
 *
 * Every outcome is rendered. The previous version did `if (res.ok) setDrives(...)`
 * with no else and no catch, so a failed call left `drives` null and the panel sat
 * on "Loading disk info..." forever, while a *successful* call returning `[]` —
 * which `si.fsSize()` does on any failure and always does in the Node-only
 * fallback — passed the `!drives` guard and rendered an empty list. Both looked
 * identical on screen: nothing. Silence is not an acceptable state for a panel.
 */
function DiskPanel() {
  const [drives, setDrives]   = useState(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await systemClient.getDiskUsage()
      .catch(err => ({ ok: false, error: err?.message ?? 'disk call failed' }));
    if (res?.ok && Array.isArray(res.data)) {
      setDrives(res.data);
      setError('');
    } else {
      setDrives(null);
      setError(res?.error ?? 'Disk usage unavailable');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !drives && !error) {
    return <div style={{ color: 'var(--muted)', fontSize: '11px' }}>Reading drive usage...</div>;
  }

  if (error) {
    return (
      <div style={{ fontSize: '11px', lineHeight: 1.7 }}>
        <div style={{ color: 'var(--amber)' }}>{error}</div>
        <div style={{ color: 'var(--muted)', marginTop: '6px' }}>
          Drive enumeration needs the optional <code>systeminformation</code> module;
          Node alone cannot list filesystems. Everything else keeps working.
        </div>
        <button className="btn btn-sm" style={{ marginTop: '10px' }} onClick={load}>↺ Try again</button>
      </div>
    );
  }

  if (!drives || drives.length === 0) {
    return (
      <div style={{ fontSize: '11px', lineHeight: 1.7 }}>
        <div style={{ color: 'var(--text-dim)' }}>No drives reported.</div>
        <div style={{ color: 'var(--muted)', marginTop: '6px' }}>
          The call succeeded but returned an empty list — typical when
          <code> systeminformation </code> is running in its reduced mode.
        </div>
        <button className="btn btn-sm" style={{ marginTop: '10px' }} onClick={load}>↺ Try again</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {drives.map((d, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text)', fontSize: '12px' }}>{d.mount} ({d.fs})</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
              {formatBytes(d.used)} / {formatBytes(d.size)} ({Math.round(d.usedPct)}%)
            </span>
          </div>
          <div style={{ height: '6px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, d.usedPct)}%`, height: '100%',
              background: d.usedPct > 85 ? 'var(--red)' : d.usedPct > 65 ? 'var(--amber)' : 'var(--green)',
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}
