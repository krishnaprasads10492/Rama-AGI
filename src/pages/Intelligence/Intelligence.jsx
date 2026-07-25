import React, { useState, useEffect, useRef, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.rama;

const CATEGORIES = [
  { id: 'general',   icon: '◈', label: 'General',   color: 'var(--accent)'  },
  { id: 'financial', icon: '◬', label: 'Financial',  color: 'var(--green)'   },
  { id: 'political', icon: '⬡', label: 'Political',  color: 'var(--amber)'   },
  { id: 'scientific',icon: '⊕', label: 'Scientific', color: 'var(--violet)'  },
  { id: 'sports',    icon: '◎', label: 'Sports',     color: 'var(--magenta)' },
  { id: 'tech',      icon: '⬢', label: 'Technology', color: 'var(--accent)'  },
];

const DEPTH_OPTIONS = [
  { id: 'quick',    label: 'Quick',    desc: '3 sources, 10s'  },
  { id: 'standard', label: 'Standard', desc: '8 sources, 30s'  },
  { id: 'deep',     label: 'Deep',     desc: '15+ sources, 2m' },
];

function GradeRing({ grade, confidence }) {
  const color =
    grade === 'A' ? 'var(--green)'  :
    grade === 'B' ? 'var(--accent)' :
    grade === 'C' ? 'var(--amber)'  :
    grade === 'D' ? 'var(--red)'    : 'var(--muted)';
  return (
    <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
      <svg width="80" height="80" style={{ position: 'absolute', top: 0, left: 0 }}>
        <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx="40" cy="40" r="34" fill="none" stroke={color}
          strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(confidence / 100) * 213.6} 213.6`}
          transform="rotate(-90 40 40)"
          style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'stroke-dasharray 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{grade}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{confidence}%</span>
      </div>
    </div>
  );
}

function SourceBadge({ source }) {
  const credColor =
    source.credibility >= 85 ? 'var(--green)' :
    source.credibility >= 65 ? 'var(--accent)' :
    source.credibility >= 45 ? 'var(--amber)'  : 'var(--muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      fontSize: 11 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: credColor, flexShrink: 0 }} />
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{source.domain}</span>
      <span style={{ color: credColor, fontSize: 10, marginLeft: 'auto' }}>{source.credibility}%</span>
      <span style={{ color: 'var(--muted)', fontSize: 10 }}>{source.bias}</span>
    </div>
  );
}

function PipelineStep({ step, data, isActive }) {
  const icons = { decompose: '◈', gather: '⬢', vet: '◎', crossref: '⊕', extract: '⬡', complete: '✓' };
  const colors = { decompose: 'var(--accent)', gather: 'var(--green)', vet: 'var(--amber)',
    crossref: 'var(--violet)', extract: 'var(--magenta)', complete: 'var(--green)' };
  return (
    <div className="fade-in" style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: colors[step] || 'var(--muted)', fontSize: 13, minWidth: 16 }}>
        {isActive ? '⬡' : (icons[step] || '·')}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: colors[step] || 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em' }}>{step}</span>
        {data?.message && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{data.message}</div>
        )}
        {data?.subQueries && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {data.subQueries.map((q, i) => (
              <span key={i} style={{ fontSize: 10, color: 'var(--accent)', background: 'rgba(0,255,255,0.06)',
                border: '1px solid rgba(0,255,255,0.2)', borderRadius: 2, padding: '1px 6px' }}>{q}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Intelligence() {
  const [query,    setQuery]    = useState('');
  const [category, setCategory] = useState('general');
  const [depth,    setDepth]    = useState('standard');
  const [running,  setRunning]  = useState(false);
  const [steps,    setSteps]    = useState([]);
  const [result,   setResult]   = useState(null);
  const [sessions, setSessions] = useState([]);
  const [tab,      setTab]      = useState('query');
  const inputRef = useRef(null);

  useEffect(() => {
    loadSessions();
    if (!isElectron) return;
    // Listen for progress events
    const unsub = window.ipcRenderer?.on('intel:progress', (_e, data) => {
      setSteps(s => [...s, { step: data.step, data: data.data, ts: Date.now() }]);
    });
    return () => unsub?.();
  }, []);

  const loadSessions = async () => {
    if (!isElectron) return;
    const res = await window.ipcRenderer?.invoke('intel:list-sessions');
    if (res?.ok) setSessions(res.data);
  };

  const runAnalysis = useCallback(async () => {
    if (!query.trim() || running) return;
    setRunning(true);
    setSteps([]);
    setResult(null);
    setTab('pipeline');

    if (!isElectron) {
      // Dev mode mock
      setTimeout(() => {
        setResult({
          query: query.trim(), category, overallConfidence: 72.5, grade: 'B',
          complementLabel: '72.5% confidence means ~27.5% chance of being wrong',
          sourceCount: 6,
          sourceSummary: [
            { domain: 'reuters.com',   credibility: 95, bias: 'center',  type: 'financial-news' },
            { domain: 'bloomberg.com', credibility: 93, bias: 'center',  type: 'financial-news' },
            { domain: 'apnews.com',    credibility: 96, bias: 'center',  type: 'general-news'   },
          ],
          keyFindings: [{ source: 'reuters.com', credibility: 0.95, finding: 'Multiple sources confirm the trend.', bias: 'center' }],
          agreements: [{ phrase: 'consistent growth', sources: ['reuters.com', 'bloomberg.com'], count: 2 }],
          contradictions: [],
          recommendation: 'Moderate confidence. Multiple sources agree but some uncertainty remains.',
          disclaimer: 'This analysis is generated from publicly available sources. Informational only.',
          suppressed: false,
        });
        setRunning(false);
        setTab('result');
      }, 1500);
      return;
    }

    const res = await window.ipcRenderer?.invoke('intel:analyze', {
      query: query.trim(), depth, category,
    });

    setRunning(false);
    if (res?.ok && res.result) {
      setResult(res.result);
      setTab('result');
      loadSessions();
    }
  }, [query, category, depth, running]);

  const cat = CATEGORIES.find(c => c.id === category) || CATEGORIES[0];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>◈</span>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em' }}>
            UNIVERSAL INTELLIGENCE ENGINE
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            Multi-source truth extraction · Human-emulated gathering · Calibrated confidence
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span className="badge badge-cyan">{sessions.length} ANALYSES</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['query', 'pipeline', 'result', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 18px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', textTransform: 'uppercase',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, minHeight: 0 }}>

        {/* ── Query tab ── */}
        {tab === 'query' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
            <div className="hud-card" style={{ padding: 20 }}>
              <div className="section-label" style={{ marginBottom: 10 }}>
                WHAT DO YOU WANT TO KNOW?
              </div>
              <textarea className="input" rows={4}
                placeholder={`Ask anything...\n\nExamples:\n• "Will Nifty 50 break 25000 this week?"\n• "What is the scientific consensus on intermittent fasting?"\n• "Who is likely to win the next India election?"\n• "Is Tesla stock a buy right now?"`}
                value={query} onChange={e => setQuery(e.target.value)}
                style={{ resize: 'vertical', marginBottom: 12 }} />

              {/* Category */}
              <div className="section-label" style={{ marginBottom: 8 }}>CATEGORY</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {CATEGORIES.map(c => (
                  <button key={c.id} onClick={() => setCategory(c.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                    border: `1px solid ${category === c.id ? c.color : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', background: category === c.id ? `${c.color}18` : 'transparent',
                    color: category === c.id ? c.color : 'var(--muted)',
                    cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11,
                  }}>
                    <span>{c.icon}</span><span>{c.label}</span>
                  </button>
                ))}
              </div>

              {/* Depth */}
              <div className="section-label" style={{ marginBottom: 8 }}>ANALYSIS DEPTH</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {DEPTH_OPTIONS.map(d => (
                  <button key={d.id} onClick={() => setDepth(d.id)} style={{
                    flex: 1, padding: '8px 10px', border: `1px solid ${depth === d.id ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', background: depth === d.id ? 'rgba(0,255,255,0.06)' : 'transparent',
                    color: depth === d.id ? 'var(--accent)' : 'var(--muted)',
                    cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'center',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{d.label}</div>
                    <div style={{ fontSize: 10, marginTop: 2 }}>{d.desc}</div>
                  </button>
                ))}
              </div>

              <button className="btn btn-primary" disabled={!query.trim() || running}
                onClick={runAnalysis}
                style={{ width: '100%', justifyContent: 'center', padding: 11, fontSize: 13 }}>
                {running ? '⬡ Gathering intelligence...' : `◈ Analyze — ${cat.label}`}
              </button>
            </div>

            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7, padding: '0 4px' }}>
              ⚠ Intelligence analysis is for informational purposes only. Sources are gathered
              from public outlets and vetted for credibility. No guarantees of accuracy.
              Always verify independently before making decisions.
            </div>
          </div>
        )}

        {/* ── Pipeline tab ── */}
        {tab === 'pipeline' && (
          <div style={{ maxWidth: 600 }}>
            <div className="hud-card" style={{ padding: 16 }}>
              <div className="section-label" style={{ marginBottom: 12 }}>ANALYSIS PIPELINE</div>
              {steps.length === 0 && !running ? (
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>No analysis running.</div>
              ) : (
                steps.map((s, i) => (
                  <PipelineStep key={i} step={s.step} data={s.data} isActive={i === steps.length - 1 && running} />
                ))
              )}
              {running && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                  color: 'var(--accent)', fontSize: 11 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)',
                    animation: 'pulse-ring 1s ease infinite', boxShadow: 'var(--glow-cyan)' }} />
                  Processing...
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Result tab ── */}
        {tab === 'result' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
            {/* Suppressed warning */}
            {result.suppressed && (
              <div style={{ padding: 12, background: 'rgba(255,0,60,0.08)', border: '1px solid rgba(255,0,60,0.3)',
                borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 12 }}>
                ⚠ Confidence too low to display reliably. Treat as speculative only.
              </div>
            )}

            {/* Main result card */}
            <div className="hud-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 16 }}>
                <GradeRing grade={result.grade} confidence={result.overallConfidence} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6, lineHeight: 1.4 }}>
                    {result.query}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 4 }}>
                    {result.recommendation}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {result.complementLabel}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ textAlign: 'center', padding: '6px 14px', background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{result.sourceCount}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Sources</div>
                </div>
                <div style={{ textAlign: 'center', padding: '6px 14px', background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{result.agreements?.length || 0}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Agreements</div>
                </div>
                <div style={{ textAlign: 'center', padding: '6px 14px', background: 'var(--surface)',
                  border: `1px solid ${result.contradictions?.length > 0 ? 'rgba(255,0,60,0.3)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: result.contradictions?.length > 0 ? 'var(--red)' : 'var(--muted)' }}>
                    {result.contradictions?.length || 0}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Contradictions</div>
                </div>
              </div>

              {/* Sources */}
              <div className="section-label" style={{ marginBottom: 8 }}>SOURCES VETTED</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                {result.sourceSummary?.map((s, i) => <SourceBadge key={i} source={s} />)}
              </div>

              {/* Key findings */}
              {result.keyFindings?.length > 0 && (
                <>
                  <div className="section-label" style={{ marginBottom: 8 }}>KEY FINDINGS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {result.keyFindings.map((f, i) => (
                      <div key={i} style={{ padding: '10px 12px', background: 'var(--surface)',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{f.source}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 10 }}>{Math.round(f.credibility * 100)}% credibility</span>
                        </div>
                        <div style={{ color: 'var(--text-dim)', lineHeight: 1.6 }}>{f.finding}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Contradictions */}
              {result.contradictions?.length > 0 && (
                <>
                  <div className="section-label" style={{ marginBottom: 8, color: 'var(--red)' }}>⚠ CONTRADICTIONS DETECTED</div>
                  {result.contradictions.map((c, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: 'rgba(255,0,60,0.05)',
                      border: '1px solid rgba(255,0,60,0.3)', borderRadius: 'var(--radius)', fontSize: 11, marginBottom: 6 }}>
                      <div style={{ color: 'var(--red)', fontWeight: 700 }}>{c.message}</div>
                      {c.positive && <div style={{ color: 'var(--green)', marginTop: 4 }}>Positive: {c.positive.join(', ')}</div>}
                      {c.negative && <div style={{ color: 'var(--red)', marginTop: 2 }}>Negative: {c.negative.join(', ')}</div>}
                    </div>
                  ))}
                </>
              )}

              {/* Disclaimer */}
              <div style={{ fontSize: 10, color: 'var(--muted)', padding: '10px 12px', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)', lineHeight: 1.6 }}>
                ⚠ {result.disclaimer}
              </div>
            </div>
          </div>
        )}

        {/* ── History tab ── */}
        {tab === 'history' && (
          <div className="hud-card" style={{ overflow: 'hidden' }}>
            {sessions.length === 0 ? (
              <div style={{ padding: 20, color: 'var(--muted)', textAlign: 'center', fontSize: 12 }}>
                No analyses yet.
              </div>
            ) : sessions.map((s, i) => (
              <div key={i} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                onClick={() => { /* load session */ }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                  fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
                  {s.grade || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.query}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    {s.category} · {new Date(s.startedAt).toLocaleString()} · {s.confidence ?? '?'}% confidence
                  </div>
                </div>
                <span className={`badge ${s.status === 'complete' ? 'badge-green' : s.status === 'error' ? 'badge-red' : 'badge-amber'}`}
                  style={{ fontSize: 9 }}>{s.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
