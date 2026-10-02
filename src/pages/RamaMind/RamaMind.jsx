import React, { useEffect, useState, useCallback } from 'react';
import { getRamaStatus, getSelfModel, ramaMemory, ramaWorld,
         ramaProactive, ramaRevision } from '@services/ramaCore.js';
import { useUserStore } from '@store/userStore.js';
import { skillSummary } from '@services/cognition.js';
import RamaOrb from '@components/RamaOrb.jsx';

/**
 * RamaMind — what Rāma can actually do, what it cannot, and what would change that.
 *
 * ── WHAT THIS PAGE USED TO BE, AND WHY IT CHANGED (Section 126) ──────────────────────────────────
 *
 * It was an "AGI Consciousness Dashboard" showing ten capability axes as bars out of ten, with their
 * geometric mean as an "AAI Index" of about 7.0. **Every one of those numbers was a hardcoded literal
 * in `ramaCore.js`.** Nothing measured them, and two were contradicted by measurement: generality was
 * 8/10 "Any domain, any task" for a system Section 124 placed on the Narrow column with no claim on
 * the General column, and memory was 6/10 "4-layer persistent memory" for a store that keeps lengths
 * in `sessionStorage` and loses them when the window closes.
 *
 * Master approved the replacement with one instruction: **maximum benefit, less trouble for him.** So
 * this is deliberately not a smaller page. It is the same page driven by `selfModel.describe()`, where
 * every field carries its source and anything unmeasured is `null` rather than estimated — and where
 * the LIMITS are derived from what is absent right now, each carrying a `fixable` line naming what
 * would change it.
 *
 * **That is the benefit: ten invented numbers told master nothing he could act on; a derived limit
 * with its fix is a to-do list computed from measurement.** So the limits are the FIRST thing on the
 * page rather than an appendix, which is also the rule `selfModel.cjs` holds itself to.
 *
 * A bar chart is not reinstated for anything here. A score implies a scale with a top, and the moment
 * one exists somebody fills it in.
 */

/** `{value, source, measured}` from the self-model, rendered so an unmeasured field cannot pass as 0. */
function Fact({ label, field }) {
  const measured = field && field.measured;
  const value = field ? field.value : null;
  const shown = measured
    ? (value === true ? 'yes' : value === false ? 'no' : (value ?? '—'))
    : 'not measured';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '5px 0',
      borderBottom: '1px solid var(--border)', alignItems: 'baseline' }}>
      <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: '11px', textAlign: 'right',
        color: measured ? 'var(--text)' : 'var(--muted)',
        fontStyle: measured ? 'normal' : 'italic' }}
        title={field ? `source: ${field.source}${field.why ? ` — ${field.why}` : ''}` : 'absent'}>
        {String(shown)}
      </span>
    </div>
  );
}

/**
 * THE LIMITS, FIRST. Each is derived from something absent, names its source, and — where there is
 * one — names the fix. The fix is given the accent colour because it is the only line on this page
 * master can act on directly.
 */
function LimitsPanel({ limits }) {
  if (!limits) return null;
  if (limits.length === 0) {
    return (
      <div className="hud-card" style={{ padding: '16px' }}>
        <div className="section-label" style={{ marginBottom: '8px' }}>◈ WHAT IS MISSING</div>
        <div style={{ fontSize: '12px', color: 'var(--green)' }}>
          Nothing that was checked for is currently missing.
        </div>
        <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '6px', lineHeight: 1.5 }}>
          This is a statement about the checks that ran, not a claim of completeness.
        </div>
      </div>
    );
  }
  return (
    <div className="hud-card" style={{ padding: '16px', marginBottom: '14px' }}>
      <div className="section-label" style={{ marginBottom: '10px' }}>
        ◈ WHAT IS MISSING ({limits.length}) — AND WHAT WOULD FIX IT
      </div>
      {limits.map((l, i) => (
        <div key={i} style={{ padding: '10px', marginBottom: '6px', borderRadius: 'var(--radius)',
          background: 'var(--surface)', border: '1px solid var(--amber)44' }}>
          <div style={{ fontSize: '12px', color: 'var(--text)', fontWeight: 600 }}>{l.what}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim, var(--muted))', marginTop: '3px',
            lineHeight: 1.5 }}>{l.why}</div>
          {l.fixable && (
            <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '5px' }}>
              → {l.fixable}
            </div>
          )}
          <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '4px' }}>
            measured from: {l.source}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The measured account. Sources travel with it, and the attestation rule is printed, not implied. */
function MeasuredPanel({ account, unavailable, reason }) {
  if (unavailable) {
    return (
      <div className="hud-card" style={{ padding: '16px' }}>
        <div className="section-label" style={{ marginBottom: '8px' }}>◈ MEASURED SELF-ACCOUNT</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.6 }}>
          Not measured{reason ? ` — ${reason}` : ''}.{' '}
          <strong style={{ color: 'var(--text-dim, var(--muted))' }}>
            Nothing is estimated in its place
          </strong>
          , which is the point: this page used to show ten numbers here whatever was running.
        </div>
      </div>
    );
  }
  if (!account) {
    return (
      <div className="hud-card" style={{ padding: '16px' }}>
        <div className="section-label" style={{ marginBottom: '8px' }}>◈ MEASURED SELF-ACCOUNT</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Measuring…</div>
      </div>
    );
  }
  const id = account.identity || {};
  const ab = account.ability || {};
  return (
    <>
      <LimitsPanel limits={account.limits} />

      <div className="hud-card" style={{ padding: '16px', marginBottom: '14px' }}>
        <div className="section-label" style={{ marginBottom: '8px' }}>◈ IN ITS OWN WORDS</div>
        <div style={{ fontSize: '12.5px', color: 'var(--text)', lineHeight: 1.65 }}>
          {account.summary?.text}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div className="hud-card" style={{ padding: '16px' }}>
          <div className="section-label" style={{ marginBottom: '8px' }}>IDENTITY</div>
          <Fact label="Name" field={id.name} />
          <Fact label="Version" field={id.version} />
          <Fact label="Packaged" field={id.packaged} />
          {/* ATTESTATION, NOT A SCORE. The old page rated loyalty 10/10; I16 forbids reading the
              matrix at all, so the only honest field is whether the core is sealed and verified. */}
          <Fact label="Loyalty core" field={id.loyalty} />
          <Fact label="Serves" field={id.serves} />
          <Fact label="Role" field={id.role} />
          <Fact label="Genome" field={id.genome} />
        </div>

        <div className="hud-card" style={{ padding: '16px' }}>
          <div className="section-label" style={{ marginBottom: '8px' }}>WHAT CAN ANSWER NOW</div>
          <Fact label="Reflex skills" field={ab.reflexSkills} />
          <Fact label="Local model" field={ab.localModel} />
          <Fact label="Cloud model" field={ab.cloudModel} />
          <Fact label="Highest tier" field={ab.highestTier} />
          <Fact label="Gated capabilities" field={ab.gatedCapabilities} />
          <Fact label="Yours to use" field={ab.capabilitiesForThisUser} />
          <Fact label="Market engine" field={ab.marketEngine} />
          <Fact label="Projects known" field={ab.projectsKnown} />
        </div>
      </div>

      <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '12px', lineHeight: 1.6 }}>
        {account.attestation?.rule}
        {account.attestation?.sources?.length
          ? ` Sources: ${account.attestation.sources.join(', ')}.` : ''}
        {account.attestation?.generatedAt
          ? ` Measured at ${new Date(account.attestation.generatedAt).toLocaleTimeString()}.` : ''}
      </div>
    </>
  );
}

function MemoryPanel({ memory }) {
  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      {/* THE COUNTS ARE REAL; THE WORD "PERSISTENT" WAS NOT (Section 126). These four layers are the
          CoALA shape, and all four are SESSION-SCOPED here — in-process or `sessionStorage`, gone when
          the window closes. The durable store CoALA assumes does not exist yet, which is why the old
          capability bar reading "4-layer persistent memory" was the second measured falsehood on this
          page. Procedural is a literal 0 because nothing writes it at all, and it is left visible
          rather than hidden so the gap is legible. */}
      <div className="section-label" style={{ marginBottom: '4px' }}>◈ MEMORY (CoALA shape)</div>
      <div style={{ fontSize: '10px', color: 'var(--amber)', marginBottom: '12px', lineHeight: 1.5 }}>
        Session-scoped, not persistent — these reset when the window closes. Durable memory with
        provenance is named as the next capability step, not shipped.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {[
          { layer: 'Working',    color: 'var(--accent)',  count: memory?.working?.recentMessages?.length ?? 0, desc: 'Current session context' },
          { layer: 'Episodic',   color: 'var(--violet)',  count: memory?.episodicCount ?? 0,  desc: 'This session\u2019s interactions' },
          { layer: 'Semantic',   color: 'var(--green)',   count: memory?.semanticCount ?? 0,  desc: 'Facts noted this session' },
          { layer: 'Procedural', color: 'var(--amber)',   count: 0,                            desc: 'Nothing writes this yet' },
        ].map(m => (
          <div key={m.layer} style={{ background: 'var(--surface)', borderRadius: 'var(--radius)',
            border: `1px solid ${m.color}33`, padding: '10px' }}>
            <div style={{ fontSize: '10px', color: m.color, fontWeight: 700, letterSpacing: '0.08em' }}>{m.layer}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: m.color, marginTop: '4px' }}>{m.count}</div>
            <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{m.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorldModelPanel({ world }) {
  if (!world) return null;
  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      <div className="section-label" style={{ marginBottom: '12px' }}>🌐 WORLD MODEL</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {[
          ['Master',    world.master?.name],
          ['Timezone',  world.master?.timezone],
          ['Platform',  world.system?.os || 'Detecting...'],
          ['Projects',  `${world.system?.projects?.length ?? 0} detected`],
          ['Goals',     `${world.master?.goals?.length ?? 0} active`],
          ['Pending tasks', `${world.pending ?? 0}`],
          ['Scheduled', `${world.scheduled ?? 0}`],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0',
            borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{k}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImprovementsPanel({ improvements, onDismiss }) {
  if (!improvements?.length) {
    return (
      <div className="hud-card" style={{ padding: '16px' }}>
        <div className="section-label" style={{ marginBottom: '12px' }}>⚡ SELF-REVISION INSIGHTS</div>
        <div style={{ color: 'var(--muted)', fontSize: '12px', textAlign: 'center', padding: '12px' }}>
          No improvement insights yet. Rāma learns from interactions.
        </div>
      </div>
    );
  }
  const priorityColor = { high: 'var(--red)', medium: 'var(--amber)', low: 'var(--muted)' };
  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      <div className="section-label" style={{ marginBottom: '12px' }}>⚡ SELF-REVISION INSIGHTS ({improvements.length})</div>
      {improvements.map((imp, i) => (
        <div key={i} style={{ padding: '10px', marginBottom: '6px', borderRadius: 'var(--radius)',
          background: 'var(--surface)', border: `1px solid ${priorityColor[imp.priority]}44` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '10px', color: priorityColor[imp.priority], fontWeight: 700, textTransform: 'uppercase' }}>
              {imp.priority} priority · {imp.type}
            </span>
            <button onClick={() => onDismiss(i)} style={{ background: 'none', border: 'none',
              color: 'var(--muted)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font)' }}>✕</button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text)', marginBottom: '4px' }}>{imp.finding}</div>
          <div style={{ fontSize: '11px', color: 'var(--accent)' }}>→ {imp.action}</div>
        </div>
      ))}
    </div>
  );
}

export default function RamaMind() {
  const [status,       setStatus]       = useState(null);
  const [improvements, setImprovements] = useState([]);
  const [tab,          setTab]          = useState('measured');
  const [account,      setAccount]      = useState(null);
  // Distinguished from "not yet loaded", because "there is nothing to ask" and "we have not asked"
  // are different facts and the page must not render one as the other.
  const [noBridge,     setNoBridge]     = useState(false);
  const [bridgeReason, setBridgeReason] = useState(null);
  const { currentUser } = useUserStore();

  const refresh = useCallback(() => {
    const s = getRamaStatus();
    setStatus(s);
    setImprovements(ramaRevision.getImprovements());
  }, []);

  // MEASURING IS SEPARATE FROM POLLING, and much slower: it runs probes in the main process. The
  // 5-second status poll must not drag a full self-measurement behind it.
  const measure = useCallback(async () => {
    // The tier-0 skill count is a RENDERER fact, so it is handed over rather than left unmeasured.
    let reflexSkills;
    try { reflexSkills = skillSummary()?.total; } catch { reflexSkills = undefined; }
    const res = await getSelfModel(currentUser, { reflexSkills });
    setAccount(res.account);
    setNoBridge(res.unavailable);
    setBridgeReason(res.reason);
  }, [currentUser]);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { measure(); }, [measure]);

  const dismissImprovement = (i) => { ramaRevision.clearImprovement(i); refresh(); };

  const limitCount = account?.limits?.length ?? null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
        <RamaOrb size={32} />
        <div>
          <div style={{ fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em' }}>RĀMA MIND</div>
          {/* The subtitle is now a description of the page rather than a claim about the system. */}
          <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
            Measured self-account · every field carries its source
          </div>
        </div>
        {/* THE PILL COUNTS WHAT IS MISSING, NOT A SCORE. An index invites "make the number go up";
            a count of named gaps, each with a fix, invites closing one. */}
        <div className="metric-pill" style={{ marginLeft: 'auto', borderColor: 'var(--amber)44' }}
             title={'Limits derived from what is absent right now. Each names its source and, '
               + 'where there is one, the fix.'}>
          <span style={{ color: 'var(--muted)', fontSize: '10px' }}>Missing</span>
          <span style={{ color: limitCount === 0 ? 'var(--green)' : 'var(--amber)',
            fontWeight: 700, fontSize: '14px' }}>
            {limitCount === null ? '—' : limitCount}
          </span>
        </div>
        <button className="btn btn-sm" onClick={() => { refresh(); measure(); }}>↺</button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['measured', 'memory', 'world', 'proactive', 'self-revision'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 14px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--violet)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--violet)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '10px',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>
        {tab === 'measured' && <MeasuredPanel account={account} unavailable={noBridge} />}
        {tab === 'memory' && <MemoryPanel memory={status?.memory} />}
        {tab === 'world'  && <WorldModelPanel world={status?.world} />}
        {tab === 'proactive' && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div className="section-label" style={{ marginBottom: '12px' }}>⚡ PROACTIVE TRIGGERS</div>
            {ramaProactive.getTriggers().map((t, i) => (
              <div key={i} style={{ padding: '10px', marginBottom: '6px', background: 'var(--surface)',
                borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--amber)' }}>{t.name}</span>
                  <span className="badge badge-amber" style={{ fontSize: '9px' }}>{t.type}</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>{t.desc}</div>
              </div>
            ))}
          </div>
        )}
        {tab === 'self-revision' && (
          <ImprovementsPanel improvements={improvements} onDismiss={dismissImprovement} />
        )}
      </div>
    </div>
  );
}
