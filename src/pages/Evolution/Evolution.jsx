import React, { useState, useEffect, useCallback } from 'react';
import { emitActivity } from '@components/ActivityStream.jsx';
import { useUserStore } from '@store/userStore.js';

const isElectron = typeof window !== 'undefined' && !!window.rama;

const CATEGORIES = [
  { id: 'ai-reasoning',    label: 'AI Reasoning',     icon: '◈', color: 'var(--violet)'  },
  { id: 'vector-search',   label: 'Vector Search',    icon: '⊕', color: 'var(--accent)'  },
  { id: 'nlp-processing',  label: 'NLP Processing',   icon: '◉', color: 'var(--green)'   },
  { id: 'security',        label: 'Security',         icon: '⬡', color: 'var(--red)'     },
  { id: 'performance',     label: 'Performance',      icon: '⬢', color: 'var(--amber)'   },
  { id: 'browser-evasion', label: 'Browser Evasion',  icon: '◎', color: 'var(--magenta)' },
  { id: 'agent-patterns',  label: 'Agent Patterns',   icon: '◬', color: 'var(--violet)'  },
  { id: 'prediction',      label: 'Prediction',       icon: '◈', color: 'var(--green)'   },
];

const LICENSE_COLORS = {
  'MIT':        'var(--green)',
  'Apache-2.0': 'var(--green)',
  'BSD-3-Clause': 'var(--green)',
  'ISC':        'var(--green)',
  'Unknown':    'var(--amber)',
  'GPL-3.0':    'var(--red)',
  'GPL-2.0':    'var(--red)',
  'AGPL-3.0':   'var(--red)',
};

function FindingCard({ finding, onAnalyze, onReadSource }) {
  const [expanded, setExpanded] = useState(false);
  const licColor = finding.licenseOk ? 'var(--green)' : 'var(--red)';
  const typeIcon = finding.type === 'github-repo' ? '⎇' : finding.type === 'npm-package' ? '◈' : '◉';

  return (
    <div className="hud-card glow-hover" style={{
      padding:     14,
      marginBottom: 8,
      borderColor: finding.licenseOk ? 'var(--border)' : 'rgba(255,0,60,0.3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Type icon */}
        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius)', flexShrink: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: 'var(--accent)' }}>
          {typeIcon}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              {finding.name}
            </span>
            {finding.stars && (
              <span style={{ fontSize: 10, color: 'var(--amber)' }}>⭐ {finding.stars.toLocaleString()}</span>
            )}
            <span style={{ fontSize: 10, color: licColor, border: `1px solid ${licColor}44`,
              padding: '1px 6px', borderRadius: 2 }}>
              {finding.licenseOk ? '✓' : '⚠'} {finding.license}
            </span>
            {finding.language && (
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{finding.language}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.5 }}>
            {finding.description?.slice(0, 120) || 'No description'}
          </div>
          {finding.topics?.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
              {finding.topics.slice(0, 5).map(t => (
                <span key={t} style={{ fontSize: 9, color: 'var(--accent)', background: 'rgba(0,255,255,0.06)',
                  border: '1px solid rgba(0,255,255,0.2)', borderRadius: 2, padding: '1px 5px' }}>{t}</span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
          {finding.licenseOk && (
            <button className="btn btn-sm btn-primary" style={{ fontSize: 10 }}
              onClick={() => onAnalyze(finding)}>
              ⚡ Analyze
            </button>
          )}
          {finding.url && (
            <button className="btn btn-sm" style={{ fontSize: 10 }}
              onClick={() => isElectron && window.rama.shell.openExternal(finding.url)}>
              🌐 View
            </button>
          )}
        </div>
      </div>

      {!finding.licenseOk && (
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--red)', padding: '4px 8px',
          background: 'rgba(255,0,60,0.08)', borderRadius: 'var(--radius)' }}>
          ⚠ License {finding.license} may restrict use. Cannot analyze without master review.
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal, onApprove, onReject, onApply, onPublish, repoPath }) {
  const statusColors = {
    pending:  'var(--amber)',
    approved: 'var(--green)',
    rejected: 'var(--red)',
    applied:  'var(--violet)',
  };
  const [expanded, setExpanded] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);

  const publish = async () => {
    setPublishing(true);
    setPublishResult(null);
    const res = await onPublish(proposal.id);
    setPublishResult(res);
    setPublishing(false);
  };

  return (
    <div className="hud-card" style={{ padding: 14, marginBottom: 8,
      borderColor: `${statusColors[proposal.status]}44` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[proposal.status],
              textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {proposal.status}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text)' }}>{proposal.source?.name}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
              {new Date(proposal.createdAt).toLocaleString()}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {proposal.summary}
          </div>
          {proposal.improvementAxes?.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              {proposal.improvementAxes.map(ax => (
                <span key={ax} style={{ fontSize: 9, color: 'var(--violet)', background: 'rgba(119,0,255,0.1)',
                  border: '1px solid rgba(119,0,255,0.3)', borderRadius: 2, padding: '1px 6px' }}>
                  {ax}
                </span>
              ))}
              <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4 }}>
                · Estimated gain: {proposal.estimatedGain}
              </span>
            </div>
          )}
          {proposal.licenseNote && (
            <div style={{ fontSize: 10, color: proposal.licenseCompliant ? 'var(--green)' : 'var(--amber)',
              marginTop: 5 }}>
              {proposal.licenseNote}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
          {proposal.status === 'pending' && (
            <>
              <button className="btn btn-sm btn-primary" style={{ fontSize: 10 }}
                onClick={() => onApprove(proposal.id)}>✓ Approve</button>
              <button className="btn btn-sm btn-danger" style={{ fontSize: 10 }}
                onClick={() => onReject(proposal.id)}>✕ Reject</button>
            </>
          )}
          {proposal.status === 'approved' && proposal.changes?.length > 0 && (
            <button className="btn btn-sm btn-primary" style={{ fontSize: 10, color: 'var(--violet)',
              borderColor: 'var(--violet)' }}
              onClick={() => onApply(proposal.id)}>⚡ Apply</button>
          )}
          {proposal.status === 'applied' && (
            <button className="btn btn-sm" style={{ fontSize: 10, color: 'var(--accent)',
              borderColor: 'var(--accent)' }}
              disabled={publishing || !repoPath}
              onClick={publish}>
              {publishing ? '…' : '⎇ Publish branch'}
            </button>
          )}
        </div>
      </div>

      {publishResult && (
        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.6,
          color: publishResult.ok ? 'var(--green)' : 'var(--red)' }}>
          {publishResult.ok ? (
            <>
              ✓ {publishResult.note}
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 10 }}>
                  Release notes ({publishResult.generatedBy === 'ai' ? 'AI-explained' : 'structured'})
                </summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10, color: 'var(--text-dim)',
                  background: 'var(--surface)', padding: 8, borderRadius: 'var(--radius)',
                  marginTop: 4, maxHeight: 220, overflow: 'auto' }}>
                  {publishResult.releaseNotes}
                </pre>
              </details>
            </>
          ) : `✕ ${publishResult.error}`}
        </div>
      )}
    </div>
  );
}

function AssessmentRow({ item, onScout }) {
  const priorityColor = { high: 'var(--red)', medium: 'var(--amber)', low: 'var(--muted)' };
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Axis: {item.axis}</span>
          <span style={{ fontSize: 11, color: 'var(--accent)' }}>{item.score}/10</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: priorityColor[item.priority],
            textTransform: 'uppercase', letterSpacing: '0.06em', marginLeft: 'auto' }}>
            {item.priority}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{item.gap}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, fontStyle: 'italic' }}>
          Scout: {item.suggestion}
        </div>
      </div>
      <button className="btn btn-sm" style={{ fontSize: 10, flexShrink: 0 }}
        onClick={() => onScout(item)}>
        Scout →
      </button>
    </div>
  );
}

export default function Evolution() {
  const { currentUser } = useUserStore();
  const [tab,         setTab]         = useState('assess');
  const [assessment,  setAssessment]  = useState([]);
  const [findings,    setFindings]    = useState([]);
  const [proposals,   setProposals]   = useState([]);
  const [scoutQuery,  setScoutQuery]  = useState('');
  const [category,    setCategory]    = useState('ai-reasoning');
  const [scouting,    setScouting]    = useState(false);
  const [scoutLog,    setScoutLog]    = useState([]);
  const [repoPath,    setRepoPath]    = useState('');

  useEffect(() => {
    loadAssessment();
    loadProposals();

    if (!isElectron) return;
    const unsub1 = window.ipcRenderer?.on('evolution:scout-progress', (_e, d) => {
      setScoutLog(s => [...s, d]);
      emitActivity('action', `Evolution scout: ${d.step} — ${d.data?.message || JSON.stringify(d.data).slice(0, 60)}`);
    });
    const unsub2 = window.ipcRenderer?.on('evolution:scout-complete', (_e, d) => {
      setFindings(d.findings || []);
      setScouting(false);
      setTab('findings');
    });
    return () => { unsub1?.(); unsub2?.(); };
  }, []);

  const loadAssessment = async () => {
    if (!isElectron) {
      setAssessment([
        { axis: 'memory', score: 6, gap: 'No vector embeddings for semantic search', suggestion: 'Search: hnswlib OR vectra embedding typescript', category: 'vector-search', priority: 'high' },
        { axis: 'planning', score: 7, gap: 'Plan decomposition is heuristic-only', suggestion: 'Search: tree of thought reasoning agent javascript', category: 'ai-reasoning', priority: 'high' },
        { axis: 'browser-evasion', score: 7, gap: 'Limited fingerprint spoofing', suggestion: 'Search: playwright stealth fingerprint evasion', category: 'browser-evasion', priority: 'medium' },
      ]);
      return;
    }
    const res = await window.ipcRenderer?.invoke('evolution:self-assess');
    if (res?.ok) setAssessment(res.data);
  };

  const loadProposals = async () => {
    if (!isElectron) return;
    const res = await window.ipcRenderer?.invoke('evolution:get-log');
    if (res?.ok) setProposals(res.data);
  };

  const runScout = useCallback(async (query, cat) => {
    if (scouting) return;
    setScouting(true);
    setScoutLog([]);
    setFindings([]);
    setTab('scout');
    emitActivity('action', `Scouting GitHub/npm/arXiv for: ${query}`);

    if (!isElectron) {
      setTimeout(() => {
        setFindings([
          { id: 'gh_1', type: 'github-repo', name: 'owner/awesome-embedding', description: 'Fast vector similarity search', stars: 2400, language: 'TypeScript', license: 'MIT', licenseOk: true, url: 'https://github.com', quality: 78, topics: ['embedding', 'vector', 'search'] },
          { id: 'gh_2', type: 'github-repo', name: 'owner/tree-of-thought-js', description: 'Tree of thought reasoning for LLMs', stars: 890, language: 'JavaScript', license: 'Apache-2.0', licenseOk: true, url: 'https://github.com', quality: 62, topics: ['reasoning', 'llm', 'agent'] },
        ]);
        setScouting(false);
        setTab('findings');
      }, 2000);
      return;
    }

    await window.ipcRenderer?.invoke('evolution:scout', { query, category: cat, maxResults: 10 });
  }, [scouting]);

  const analyze = useCallback(async (finding) => {
    emitActivity('action', `Analyzing ${finding.name} for evolution proposal...`);
    if (!isElectron) {
      const mockProposal = {
        id: `prop_${Date.now()}`, status: 'pending', createdAt: Date.now(),
        source: finding, targetCapability: finding.topics?.[0] || 'capability',
        summary: `Studied ${finding.name}. Found relevant patterns for improvement.`,
        licenseCompliant: finding.licenseOk, licenseNote: `Source is ${finding.license} licensed — safe to learn from`,
        improvementAxes: ['memory'], estimatedGain: 'medium', changes: [],
      };
      setProposals(s => [mockProposal, ...s]);
      setTab('proposals');
      return;
    }
    const res = await window.ipcRenderer?.invoke('evolution:analyze-and-propose', {
      finding, targetCapability: finding.topics?.[0] || 'capability',
    });
    if (res?.ok) { setProposals(s => [res.data, ...s]); setTab('proposals'); }
  }, []);

  const approve = async (id) => {
    if (!isElectron) { setProposals(s => s.map(p => p.id === id ? { ...p, status: 'approved' } : p)); return; }
    await window.ipcRenderer?.invoke('evolution:approve', id);
    setProposals(s => s.map(p => p.id === id ? { ...p, status: 'approved' } : p));
  };

  const reject = async (id) => {
    if (!isElectron) { setProposals(s => s.map(p => p.id === id ? { ...p, status: 'rejected' } : p)); return; }
    await window.ipcRenderer?.invoke('evolution:reject', id);
    setProposals(s => s.map(p => p.id === id ? { ...p, status: 'rejected' } : p));
  };

  const apply = async (id) => {
    if (!isElectron || !repoPath) { alert('Set repo path first'); return; }
    const res = await window.ipcRenderer?.invoke('evolution:apply', { proposalId: id, repoPath });
    if (res?.ok) {
      setProposals(s => s.map(p => p.id === id ? { ...p, status: 'applied' } : p));
      emitActivity('complete', `Evolution applied: proposal ${id}`);
    }
  };

  // Pushes an already-applied proposal to its own self-modify/<slug> branch
  // with generated release notes — never commits to dev/source directly, so
  // the previous state stays reachable. Master-only (release.cut), same gate
  // as cutting a version release. See electron/lib/publishProposal.cjs.
  const publish = async (id) => {
    if (!isElectron || !repoPath) return { ok: false, error: 'Set repo path first' };
    const res = await window.rama.publish.proposal({ user: currentUser, repoPath, proposalId: id });
    if (res?.ok) emitActivity('complete', `Published ${id} to branch ${res.branch}`);
    return res;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 20 }}>⚡</span>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em' }}>
            SELF-EVOLUTION ENGINE
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            Rāma studies public repos to improve itself · Open-source only · Master approval required
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span className="badge badge-violet">{proposals.filter(p => p.status === 'pending').length} PENDING</span>
        <span className="badge badge-green">{proposals.filter(p => p.status === 'applied').length} APPLIED</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['assess', 'scout', 'findings', 'proposals', 'log'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 16px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--violet)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--violet)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', textTransform: 'uppercase',
          }}>
            {t}{t === 'proposals' && proposals.filter(p => p.status === 'pending').length > 0 &&
              <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--amber)' }}>
                ({proposals.filter(p => p.status === 'pending').length})
              </span>}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, minHeight: 0 }}>

        {/* ── Self-assessment ── */}
        {tab === 'assess' && (
          <div style={{ maxWidth: 700 }}>
            <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(119,0,255,0.06)',
              border: '1px solid rgba(119,0,255,0.25)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
              Rāma analyzes its own capability axes and identifies gaps. Click "Scout →" to search
              GitHub, npm, and arXiv for open-source solutions. All findings are evaluated for
              license compliance before any analysis.
            </div>
            <div className="hud-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
                fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', fontWeight: 700 }}>
                IDENTIFIED CAPABILITY GAPS
              </div>
              {assessment.map((item, i) => (
                <AssessmentRow key={i} item={item}
                  onScout={(item) => {
                    setScoutQuery(item.suggestion.replace('Search: ', ''));
                    setCategory(item.category);
                    runScout(item.suggestion.replace('Search: ', ''), item.category);
                  }} />
              ))}
            </div>
          </div>
        )}

        {/* ── Scout tab ── */}
        {tab === 'scout' && (
          <div style={{ maxWidth: 700 }}>
            <div className="hud-card" style={{ padding: 16, marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 8 }}>SEARCH QUERY</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input" value={scoutQuery} onChange={e => setScoutQuery(e.target.value)}
                  placeholder="e.g. vector embedding similarity search typescript"
                  onKeyDown={e => e.key === 'Enter' && runScout(scoutQuery, category)} />
                <button className="btn btn-primary" disabled={scouting || !scoutQuery.trim()}
                  onClick={() => runScout(scoutQuery, category)} style={{ flexShrink: 0 }}>
                  {scouting ? 'Scouting...' : '⚡ Scout'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CATEGORIES.map(c => (
                  <button key={c.id} onClick={() => setCategory(c.id)} style={{
                    padding: '4px 10px', border: `1px solid ${category === c.id ? c.color : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', background: category === c.id ? `${c.color}15` : 'transparent',
                    color: category === c.id ? c.color : 'var(--muted)', cursor: 'pointer',
                    fontFamily: 'var(--font)', fontSize: 10,
                  }}>{c.icon} {c.label}</button>
                ))}
              </div>
            </div>

            {/* Scout log */}
            {scoutLog.length > 0 && (
              <div className="hud-card" style={{ padding: 14 }}>
                <div className="section-label" style={{ marginBottom: 10 }}>SCOUT LOG</div>
                {scoutLog.map((entry, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text-dim)', padding: '3px 0',
                    borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--accent)', marginRight: 6 }}>⬢</span>
                    {entry.step}: {typeof entry.data === 'string' ? entry.data : entry.data?.message || JSON.stringify(entry.data).slice(0, 80)}
                  </div>
                ))}
                {scouting && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                    color: 'var(--accent)', fontSize: 11 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)',
                      animation: 'pulse-ring 1s ease infinite' }} />
                    Scouting...
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Findings ── */}
        {tab === 'findings' && (
          <div style={{ maxWidth: 700 }}>
            {findings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 12 }}>
                No findings yet. Run a scout from the Assess or Scout tab.
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--text-dim)' }}>
                  {findings.length} results found · {findings.filter(f => f.licenseOk).length} license-compliant
                </div>
                {findings.map(f => (
                  <FindingCard key={f.id} finding={f} onAnalyze={analyze} />
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Proposals ── */}
        {tab === 'proposals' && (
          <div style={{ maxWidth: 700 }}>
            <div style={{ marginBottom: 12 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>REPO PATH FOR APPLYING</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={repoPath} onChange={e => setRepoPath(e.target.value)}
                  placeholder="c:\CodeBase\Velvet_UI\Velvet\Rama_AGI" style={{ flex: 1, fontSize: 11 }} />
                {isElectron && (
                  <button className="btn btn-sm" onClick={async () => {
                    const res = await window.rama.fs.selectPath({ directory: true });
                    if (!res.canceled) setRepoPath(res.paths[0]);
                  }}>📁</button>
                )}
              </div>
            </div>

            {proposals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 12 }}>
                No proposals yet. Analyze findings to generate evolution proposals.
              </div>
            ) : proposals.map(p => (
              <ProposalCard key={p.id} proposal={p} onApprove={approve}
                onReject={reject} onApply={apply} onPublish={publish} repoPath={repoPath} />
            ))}
          </div>
        )}

        {/* ── Log ── */}
        {tab === 'log' && (
          <div className="hud-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
              fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', fontWeight: 700 }}>
              EVOLUTION HISTORY
            </div>
            {proposals.length === 0 ? (
              <div style={{ padding: 20, color: 'var(--muted)', textAlign: 'center', fontSize: 12 }}>
                No evolutions applied yet.
              </div>
            ) : proposals.filter(p => p.status === 'applied').map((p, i) => (
              <div key={i} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet)' }}>
                    {p.source?.name}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {new Date(p.appliedAt || p.createdAt).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.summary}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {p.improvementAxes?.map(ax => (
                    <span key={ax} style={{ fontSize: 9, color: 'var(--green)', background: 'rgba(0,255,65,0.08)',
                      border: '1px solid rgba(0,255,65,0.25)', borderRadius: 2, padding: '1px 5px' }}>
                      +{ax}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
