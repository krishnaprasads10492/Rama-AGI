import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRamaStore }  from '@store/ramaStore.js';
import { useUserStore }  from '@store/userStore.js';
import { ramaChat }      from '@services/ramaClient.js';
import { getSystemPrompt } from '@services/consciousness.js';
import { emitActivity }  from '@components/ActivityStream.jsx';

import CodeEditor from './CodeEditor.jsx';
import DiffReview from './DiffReview.jsx';
import NewProject from './NewProject.jsx';

const isElectron = typeof window !== 'undefined' && !!window.rama;

/**
 * Rāma IDE v2 — Supreme AGI Code Editor
 *
 * Upgrades from v1:
 *   ✓ Monaco editor integration (VS Code engine) via CDN
 *   ✓ Multi-model AI routing (code → codellama/GPT-4o)
 *   ✓ Online research before answering (docs + GitHub)
 *   ✓ AST analysis (understand code structure)
 *   ✓ Dependency manager (detects needed packages, installs)
 *   ✓ Code regen proposals (broken code → auto-researched fix)
 *   ✓ Sandbox execution (run code, see output, iterate)
 *   ✓ Multi-tab editor with dirty state tracking
 */

// The CDN-loading `useMonaco()` hook that used to live here has been REMOVED (spec Section 82).
// It was dead code: defined, never called, so `monacoEditor` stayed null forever and the
// textarea was the only editor while the header advertised "Monaco". It also could not have
// worked — the packaged app loads the renderer with `loadFile()`, so a remote script is exactly
// the wrong dependency. Monaco is now bundled locally; see ./monacoSetup.js and ./CodeEditor.jsx.
// ─── Language detection ────────────────────────────────────────────────────
function detectLang(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map  = { js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript',
    py:'python', json:'json', md:'markdown', css:'css', html:'html',
    sh:'shell', cjs:'javascript', mjs:'javascript', yml:'yaml', yaml:'yaml',
    rs:'rust', go:'go', sql:'sql', xml:'xml' };
  return map[ext] || 'plaintext';
}

function getFileIcon(name, isDir) {
  if (isDir) return '📁';
  const ext = (name || '').split('.').pop().toLowerCase();
  return { js:'🟨',jsx:'⚛',ts:'🔷',tsx:'⚛',py:'🐍',json:'{}',
    md:'📝',css:'🎨',html:'🌐',sh:'⬢',cjs:'🟨',yml:'⚙',
    rs:'🦀',go:'🐹',env:'🔒',enc:'🔐',sql:'🗃' }[ext] || '📄';
}

// ─── AI mode definitions ───────────────────────────────────────────────────
const AI_MODES = [
  { id:'chat',     icon:'◈', label:'Chat',     color:'var(--accent)',  modelPref:'general',  desc:'Ask anything about the code' },
  { id:'patch',    icon:'⬡', label:'Patch',    color:'var(--green)',   modelPref:'code',     desc:'Fix or improve current file' },
  { id:'generate', icon:'⚡', label:'Generate', color:'var(--violet)',  modelPref:'code',     desc:'Create new code from description' },
  { id:'review',   icon:'◉', label:'Review',   color:'var(--amber)',   modelPref:'analysis', desc:'Code review + quality report' },
  { id:'scaffold', icon:'⬢', label:'Scaffold', color:'var(--magenta)', modelPref:'code',     desc:'Create new app or project' },
  { id:'research', icon:'🔍', label:'Research', color:'var(--accent)',  modelPref:'general',  desc:'Search docs + GitHub + npm for answers' },
  { id:'regen',    icon:'↺', label:'Regen',    color:'var(--red)',     modelPref:'code',     desc:'Auto-research + fix broken code' },
  { id:'explain',  icon:'?', label:'Explain',  color:'var(--text-dim)',modelPref:'general',  desc:'Explain what this code does' },
];

// ─── File Tree ─────────────────────────────────────────────────────────────
function FileTree({ onFileOpen, activeFile, openDir = null }) {
  // WHY THIS LINE EXISTS: `currentUser` was referenced in `listDir` below and in its dependency
  // array, but was only ever declared inside the sibling `IDE()` component. It was a free
  // variable here, so React threw `ReferenceError: currentUser is not defined` while rendering
  // FileTree — and because FileTree is rendered unconditionally, the whole IDE page died on
  // mount. `window.rama.fs.listDir` was always correct, which is exactly why the renderer audit
  // passed: it resolves bridge calls and store destructures, and a free variable is outside that
  // model. See spec Section 81.
  const { currentUser } = useUserStore();
  const [cwd,      setCwd]      = useState('');
  const [entries,  setEntries]  = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [children, setChildren] = useState({});

  const listDir = useCallback(async (p) => {
    if (!isElectron || !p) return [];
    const res = await window.rama.fs.listDir(currentUser, p);
    return res.ok ? res.data : [];
  }, [currentUser]);

  useEffect(() => {
    if (!cwd) return;
    listDir(cwd).then(setEntries);
  }, [cwd, listDir]);

  // OPEN ON THE REMEMBERED PROJECT (Section 86). `cwd` used to start empty, so the tree showed
  // "Open a folder" on every visit and master re-picked the same directory. The registry knows
  // what he last worked on.
  useEffect(() => {
    if (!isElectron || cwd) return;
    let cancelled = false;
    window.rama.workspace.preferred({ user: currentUser }).then((res) => {
      const pref = res?.ok === false ? null : res?.data;
      if (!cancelled && pref?.path && !pref.missing) setCwd(pref.path);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A project created elsewhere in the IDE lands here without master navigating to it.
  useEffect(() => {
    if (openDir) setCwd(openDir);
  }, [openDir]);

  const pickFolder = async () => {
    if (!isElectron) return;
    const res = await window.rama.fs.selectPath({ directory: true });
    if (!res.canceled) {
      setCwd(res.paths[0]);
      // Remembering it here is what stops the next visit asking again.
      window.rama.workspace.register({ user: currentUser, path: res.paths[0] }).catch(() => {});
    }
  };

  const toggle = async (item) => {
    if (!item.isDir) { onFileOpen(item); return; }
    const key  = item.path;
    const next = new Set(expanded);
    if (next.has(key)) { next.delete(key); }
    else {
      next.add(key);
      if (!children[key]) {
        const c = await listDir(key);
        setChildren(prev => ({ ...prev, [key]: c }));
      }
    }
    setExpanded(next);
  };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', overflow:'hidden', borderRight:'1px solid var(--border)' }}>
      <div style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', display:'flex', gap:6, flexShrink:0 }}>
        <input className="input" value={cwd} onChange={e => setCwd(e.target.value)}
          onKeyDown={e => e.key==='Enter' && listDir(cwd).then(setEntries)}
          placeholder="Path..." style={{ fontSize:10, padding:'3px 8px', flex:1 }} />
        <button className="btn btn-sm" style={{ fontSize:10, padding:'3px 8px', flexShrink:0 }} onClick={pickFolder}>📁</button>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'2px 0' }}>
        {entries.length === 0 ? (
          <div style={{ padding:12, color:'var(--muted)', fontSize:11, textAlign:'center' }}>
            {cwd ? 'Empty' : 'Open a folder'}
          </div>
        ) : renderItems(entries, 0, expanded, children, toggle, activeFile)}
      </div>
    </div>
  );
}

function renderItems(items, depth, expanded, children, toggle, activeFile) {
  return items.map(item => {
    const isActive = activeFile?.path === item.path;
    const isExp    = expanded.has(item.path);
    return (
      <React.Fragment key={item.path}>
        <div onClick={() => toggle(item)} style={{
          display:'flex', alignItems:'center', gap:5,
          padding:`3px 10px 3px ${10 + depth * 14}px`,
          cursor:'pointer', fontSize:11,
          background: isActive ? 'rgba(0,200,255,0.08)' : 'transparent',
          color: isActive ? 'var(--accent)' : 'var(--text-dim)',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        }}
          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background='rgba(0,200,255,0.04)'; }}
          onMouseLeave={e => { if (!isActive) e.currentTarget.style.background='transparent'; }}
        >
          <span style={{ fontSize:12, flexShrink:0 }}>{getFileIcon(item.name, item.isDir)}</span>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{item.name}</span>
          {item.isDir && <span style={{ color:'var(--muted)', fontSize:10 }}>{isExp ? '▾' : '▸'}</span>}
        </div>
        {item.isDir && isExp && children[item.path] &&
          renderItems(children[item.path], depth+1, expanded, children, toggle, activeFile)}
      </React.Fragment>
    );
  });
}

// ─── AI Panel v2 ───────────────────────────────────────────────────────────
function AIPanel({ currentFile, currentContent, repoPath, onApplyPatch, onRunCode, astData }) {
  // Needed for the sandbox capability gate below — it was calling without a user and being denied.
  const { currentUser } = useUserStore();
  const [mode,       setMode]       = useState('chat');
  const [prompt,     setPrompt]     = useState('');
  const [response,   setResponse]   = useState('');
  const [loading,    setLoading]    = useState(false);
  const [research,   setResearch]   = useState([]);
  const [deps,       setDeps]       = useState([]);
  const [execResult, setExecResult] = useState(null);
  const { provider, model } = useRamaStore();

  const run = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setResearch([]);
    setDeps([]);
    setExecResult(null);

    const modeInfo = AI_MODES.find(m => m.id === mode) || AI_MODES[0];
    emitActivity('thinking', `IDE ${modeInfo.label}: ${prompt.slice(0,50)}...`);

    try {
      // ── Step 1: Research online (for research/regen/patch modes) ──────────
      let researchContext = '';
      if (['research', 'regen', 'patch'].includes(mode) && isElectron) {
        const query = mode === 'regen'
          ? `${prompt} ${currentFile?.name || ''} fix`
          : prompt;

        const resRes = await window.ipcRenderer?.invoke('regen:research', {
          errorMessage: query, language: detectLang(currentFile?.name || 'js'),
        });
        if (resRes?.ok && resRes.data?.length > 0) {
          setResearch(resRes.data);
          researchContext = resRes.data.slice(0,3).map(f => `[${f.source}] ${f.content}`).join('\n');

          // Check if any deps need installing
          const installItems = resRes.data.filter(f => f.type === 'package' && f.install);
          if (installItems.length > 0) setDeps(installItems);
        }
      }

      // ── Step 2: AST context ───────────────────────────────────────────────
      let astContext = '';
      if (astData) {
        astContext = `\nCode analysis: ${astData.summary || ''}\n` +
          (astData.issues?.length > 0 ? `Issues found: ${astData.issues.map(i => `line ${i.line}: ${i.message}`).join(', ')}` : '');
      }

      // ── Step 3: Build AI prompt ───────────────────────────────────────────
      const systemPrompt = getSystemPrompt();
      const fileCtx = currentFile
        ? `\nFile: ${currentFile.path}\nLanguage: ${detectLang(currentFile.name)}\n\`\`\`\n${(currentContent||'').slice(0,6000)}\n\`\`\``
        : '';

      const modePrompts = {
        chat:     `You are Rāma IDE. Answer directly about the code.${fileCtx}${astContext}`,
        patch:    `You are Rāma IDE. Patch the code. Return ONLY complete fixed file in a code block.${fileCtx}${astContext}\n\nResearch:\n${researchContext}`,
        generate: `You are Rāma IDE. Generate complete, production-ready code. Use code blocks with language tags.${fileCtx}`,
        review:   `You are Rāma IDE. Full code review: correctness, security, performance, maintainability. Be specific.${fileCtx}${astContext}`,
        scaffold: `You are Rāma IDE. Scaffold the described project. List all files with full content in code blocks labeled with file paths.`,
        research: `You are Rāma IDE. Research this topic and provide a comprehensive technical answer.\n\nOnline findings:\n${researchContext}\n\nAnswer:`,
        regen:    `You are Rāma IDE. Fix the broken code using the research findings below.\n\nOnline findings:\n${researchContext}${fileCtx}\nReturn ONLY the complete fixed code in a code block.`,
        explain:  `You are Rāma IDE. Explain this code clearly: what it does, how it works, key decisions.${fileCtx}${astContext}`,
      };

      const messages = [
        { role:'system', content: systemPrompt + '\n\n' + (modePrompts[mode] || modePrompts.chat) },
        { role:'user',   content: prompt },
      ];

      const res = await ramaChat.send({ messages, provider, model, sessionId:`ide_${Date.now()}` });

      if (res.ok && res.message) {
        setResponse(res.message.content);
        emitActivity('complete', `IDE ${mode} complete`);

        // ── Auto-extract patch ──────────────────────────────────────────────
        if (['patch', 'regen'].includes(mode)) {
          const codeMatch = res.message.content.match(/```[\w]*\n([\s\S]+?)```/);
          if (codeMatch) onApplyPatch?.(codeMatch[1], `IDE ${mode}: ${prompt.slice(0,50)}`);
        }

        // ── Auto-run in sandbox for generate mode ───────────────────────────
        if (mode === 'generate' && isElectron) {
          const codeMatch = res.message.content.match(/```([\w]+)\n([\s\S]+?)```/);
          if (codeMatch) {
            const lang = codeMatch[1].toLowerCase();
            const code = codeMatch[2];
            if (['javascript', 'js', 'python', 'py'].includes(lang)) {
              // `user` is REQUIRED. Without it `sandboxEngine`'s `capability.deny(user,
              // 'sandbox.execute')` rejected every run, so this path could never once have
              // worked — it failed silently because the result was only used when `ok` existed.
              const execRes = await window.ipcRenderer?.invoke('sandbox:execute',
                { user: currentUser, code, language: lang });
              if (execRes?.ok !== undefined) setExecResult(execRes);
            }
          }
        }
      } else {
        setResponse(`Error: ${res.error || 'No response'}`);
      }
    } catch (err) {
      setResponse(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, mode, currentFile, currentContent, astData, provider, model, onApplyPatch,
    currentUser]);

  const activeMode = AI_MODES.find(m => m.id === mode);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', overflow:'hidden', borderLeft:'1px solid var(--border)' }}>
      {/* Mode bar */}
      <div style={{ display:'flex', overflowX:'auto', borderBottom:'1px solid var(--border)',
        background:'var(--surface)', flexShrink:0, padding:'0 4px', scrollbarWidth:'none' }}>
        {AI_MODES.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} title={m.desc} style={{
            padding:'7px 10px', border:'none', background:'transparent',
            color: mode===m.id ? m.color : 'var(--muted)',
            borderBottom: mode===m.id ? `2px solid ${m.color}` : '2px solid transparent',
            cursor:'pointer', fontFamily:'var(--font)', fontSize:10,
            display:'flex', flexDirection:'column', alignItems:'center', gap:2, flexShrink:0,
          }}>
            <span style={{ fontSize:12 }}>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* Response area */}
      <div style={{ flex:1, overflowY:'auto', padding:12, minHeight:0, display:'flex', flexDirection:'column', gap:10 }}>

        {/* Research findings */}
        {research.length > 0 && (
          <div style={{ background:'rgba(0,200,255,0.05)', border:'1px solid rgba(0,200,255,0.2)',
            borderRadius:'var(--radius)', padding:'10px 12px', fontSize:11 }}>
            <div style={{ color:'var(--accent)', fontWeight:700, marginBottom:6, letterSpacing:'0.06em' }}>
              🔍 ONLINE RESEARCH ({research.length} sources)
            </div>
            {research.slice(0,4).map((r,i) => (
              <div key={i} style={{ color:'var(--text-dim)', marginBottom:4, lineHeight:1.5 }}>
                <span style={{ color:'var(--muted)', fontSize:10 }}>[{r.source}]</span>{' '}
                {r.content?.slice(0,120)}
                {r.install && <span style={{ color:'var(--green)', marginLeft:8 }}>→ {r.install}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Dependency alerts */}
        {deps.length > 0 && (
          <div style={{ background:'rgba(212,169,64,0.08)', border:'1px solid rgba(212,169,64,0.3)',
            borderRadius:'var(--radius)', padding:'10px 12px' }}>
            <div style={{ color:'var(--gold)', fontWeight:700, fontSize:11, marginBottom:6 }}>
              📦 PACKAGES NEEDED
            </div>
            {deps.map((d,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <code style={{ color:'var(--accent)', fontSize:11, background:'rgba(0,0,0,0.3)',
                  padding:'1px 6px', borderRadius:2 }}>{d.install}</code>
                <span style={{ fontSize:10, color:'var(--muted)' }}>{d.license}</span>
              </div>
            ))}
          </div>
        )}

        {/* Main response */}
        {response ? (
          <pre style={{ fontFamily:'var(--font)', fontSize:11, color:'var(--text)', lineHeight:1.7,
            whiteSpace:'pre-wrap', wordBreak:'break-word', margin:0, flex:1 }}>
            {response}
          </pre>
        ) : !loading && (
          <div style={{ color:'var(--muted)', fontSize:11, textAlign:'center', padding:20, flex:1, display:'flex',
            flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 }}>
            <span style={{ fontSize:24, color:activeMode?.color }}>{activeMode?.icon}</span>
            <div style={{ fontFamily:'var(--font-display)', color:activeMode?.color }}>{activeMode?.label}</div>
            <div style={{ fontSize:10 }}>{activeMode?.desc}</div>
            {['research','regen','patch'].includes(mode) && (
              <div style={{ fontSize:10, color:'var(--accent)', marginTop:4 }}>
                🔍 Will search online docs + GitHub before answering
              </div>
            )}
          </div>
        )}

        {loading && (
          <div style={{ display:'flex', alignItems:'center', gap:10, color:'var(--accent)', fontSize:11, padding:8 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--accent)',
              animation:'pulse-ring 1s ease infinite', boxShadow:'var(--glow-cyan)' }} />
            {['research','regen'].includes(mode) ? 'Searching online + generating...' : 'Thinking...'}
          </div>
        )}

        {/* Execution result */}
        {execResult && (
          <div style={{ background: execResult.ok ? 'rgba(0,214,143,0.08)' : 'rgba(255,64,96,0.08)',
            border: `1px solid ${execResult.ok ? 'rgba(0,214,143,0.3)' : 'rgba(255,64,96,0.3)'}`,
            borderRadius:'var(--radius)', padding:'10px 12px' }}>
            <div style={{ fontSize:10, fontWeight:700, marginBottom:6,
              color: execResult.ok ? 'var(--green)' : 'var(--red)' }}>
              {execResult.ok ? '✓ EXECUTED' : '✕ EXECUTION FAILED'} ({execResult.tier})
            </div>
            {execResult.output && (
              <pre style={{ fontSize:11, color:'var(--text)', whiteSpace:'pre-wrap', margin:0 }}>
                {execResult.output.slice(0,2000)}
              </pre>
            )}
            {execResult.errors && (
              <pre style={{ fontSize:11, color:'var(--red)', whiteSpace:'pre-wrap', margin:0 }}>
                {execResult.errors.slice(0,500)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding:'10px 12px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
        <textarea className="input" rows={3} value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
          placeholder={`${activeMode?.desc || 'Ask...'}${['research','regen','patch'].includes(mode) ? ' (online research included)' : ''}`}
          style={{ resize:'none', marginBottom:8, fontSize:12 }} />
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button className="btn btn-primary btn-sm" disabled={!prompt.trim()||loading}
            onClick={run} style={{ flex:1, justifyContent:'center',
              background:`${activeMode?.color}18`, borderColor:activeMode?.color, color:activeMode?.color }}>
            {loading ? '...' : `${activeMode?.icon} ${activeMode?.label}`}
          </button>
          {currentContent && (
            <button className="btn btn-sm" style={{ fontSize:10 }}
              onClick={() => setPrompt(prev => prev || 'Explain this code and suggest improvements')}>
              Quick
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Diff viewer ───────────────────────────────────────────────────────────
function DiffModal({ original, modified, description, onAccept, onReject }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:700 }}>
      <div className="neural-card" style={{ width:'85vw', maxHeight:'80vh', display:'flex',
        flexDirection:'column', padding:20, gap:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight:700, color:'var(--amber)', letterSpacing:'0.08em', fontFamily:'var(--font-display)' }}>
            ⚡ PROPOSED CHANGE
          </span>
          <span style={{ fontSize:11, color:'var(--text-dim)' }}>{description}</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, flex:1, overflow:'hidden' }}>
          {[['BEFORE', original, 'var(--red)', 'rgba(255,64,96,0.15)'],
            ['AFTER',  modified, 'var(--green)', 'rgba(0,214,143,0.15)']].map(([label, code, color, bg]) => (
            <div key={label} style={{ display:'flex', flexDirection:'column', overflow:'hidden' }}>
              <div style={{ fontSize:10, color, fontWeight:700, marginBottom:5, letterSpacing:'0.1em' }}>{label}</div>
              <pre style={{ background: bg, border:`1px solid ${color}44`,
                borderRadius:'var(--radius)', padding:12, overflow:'auto', flex:1,
                fontSize:11, fontFamily:'var(--font)', color:'var(--text)',
                whiteSpace:'pre-wrap', wordBreak:'break-all', margin:0,
                maxHeight:'48vh' }}>
                {(code||'').slice(0,4000)}
              </pre>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button className="btn btn-sm btn-danger" onClick={onReject}>✕ Reject</button>
          <button className="btn btn-sm btn-primary" onClick={onAccept}>✓ Accept & Write</button>
        </div>
      </div>
    </div>
  );
}

// ─── AST panel ─────────────────────────────────────────────────────────────
function ASTPanel({ astData, loading }) {
  if (loading) return <div style={{ padding:12, color:'var(--muted)', fontSize:11 }}>Analyzing...</div>;
  if (!astData) return null;
  return (
    <div style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', background:'var(--surface)',
      fontSize:10, display:'flex', gap:16, flexWrap:'wrap', flexShrink:0 }}>
      <span style={{ color:'var(--muted)' }}>AST:</span>
      <span style={{ color:'var(--accent)' }}>{astData.functions?.length||0} fn</span>
      <span style={{ color:'var(--violet)' }}>{astData.classes?.length||0} cls</span>
      <span style={{ color:'var(--text-dim)' }}>{astData.imports?.length||0} imports</span>
      <span style={{ color: astData.qualityScore >= 80 ? 'var(--green)' : astData.qualityScore >= 60 ? 'var(--amber)' : 'var(--red)' }}>
        Q:{astData.qualityScore}/100
      </span>
      {astData.issues?.length > 0 && (
        <span style={{ color:'var(--amber)' }}>⚠ {astData.issues.length} issues</span>
      )}
      <span style={{ color:'var(--muted)', marginLeft:'auto' }}>{astData.lines} lines · {astData.language}</span>
    </div>
  );
}

// ─── Main IDE ──────────────────────────────────────────────────────────────
export default function IDE() {
  const { currentUser } = useUserStore();
  const [tabs,        setTabs]        = useState([]);      // { file, content, dirty, id }
  const [activeTabId, setActiveTabId] = useState(null);
  const [pendingPatch,setPendingPatch] = useState(null);
  const [layout,      setLayout]      = useState('split'); // split|editor|ai
  const [astData,     setAstData]     = useState(null);
  const [astLoading,  setAstLoading]  = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectDir,  setNewProjectDir]  = useState(null);
  // `monacoEditor` state and a container ref are gone: CodeEditor owns the editor instance and
  // keeps this component's `tabs[].content` in sync through onChange, so there is one source of
  // truth for a file's text instead of two that could disagree (spec Section 82).

  const activeTab = tabs.find(t => t.id === activeTabId);

  // ── Open file ─────────────────────────────────────────────────────────────
  const openFile = useCallback(async (item) => {
    const existing = tabs.find(t => t.file?.path === item.path);
    if (existing) { setActiveTabId(existing.id); return; }

    let content = `// ${item.name}\n// Open in Electron to edit`;
    if (isElectron) {
      const res = await window.rama.fs.readFile(currentUser, item.path);
      if (res.ok) content = res.content;
    }

    const id  = `tab_${Date.now()}`;
    const tab = { id, file: item, content, dirty: false };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);

    // AST analysis
    if (isElectron && ['.js','.jsx','.cjs','.ts','.tsx','.py'].includes(`.${item.name.split('.').pop()}`)) {
      setAstLoading(true);
      window.ipcRenderer?.invoke('ast:analyze-file', item.path).then(res => {
        if (res?.ok) setAstData(res.data);
        setAstLoading(false);
      });
    }

  }, [tabs, currentUser]);

  // ── Content change ────────────────────────────────────────────────────────
  const onContentChange = useCallback((content) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, content, dirty: true } : t));
  }, [activeTabId]);

  // ── Save file ─────────────────────────────────────────────────────────────
  const saveFile = useCallback(async () => {
    if (!activeTab || !isElectron) return;
    const content = activeTab.content;
    const res = await window.rama.fs.writeFile(currentUser, activeTab.file.path, content);
    if (res.ok) {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, content, dirty: false } : t));
      emitActivity('complete', `Saved: ${activeTab.file.name}`);
    }
  }, [activeTab, activeTabId, currentUser]);

  // ── Close tab ─────────────────────────────────────────────────────────────
  const closeTab = useCallback((tabId) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) setActiveTabId(next[next.length - 1]?.id ?? null);
      return next;
    });
  }, [activeTabId]);

  // ── Apply patch ───────────────────────────────────────────────────────────
  const handlePatch = useCallback((patchedContent, description) => {
    setPendingPatch({
      content: patchedContent,
      original: activeTab?.content || '',
      path: activeTab?.file?.path || activeTab?.file?.name || '',
      description,
    });
  }, [activeTab]);

  const acceptPatch = useCallback(async () => {
    if (!pendingPatch) return;
    onContentChange(pendingPatch.content);
    setPendingPatch(null);
    if (activeTab && isElectron) {
      await window.rama.fs.writeFile(currentUser, activeTab.file.path, pendingPatch.content);
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, content: pendingPatch.content, dirty: false } : t));
    }
  }, [pendingPatch, activeTab, activeTabId, onContentChange, currentUser]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); /* handled by palette */ }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveFile]);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* A created project registers itself and opens in the tree — no second step (Section 86). */}
      {showNewProject && (
        <NewProject
          currentUser={currentUser}
          onCreated={(p) => setNewProjectDir(p)}
          onClose={() => setShowNewProject(false)}
        />
      )}

      {/* Nothing the AI proposes reaches the file until master has seen the diff (Section 82). */}
      {pendingPatch && (
        <DiffReview
          path={pendingPatch.path}
          original={pendingPatch.original}
          modified={pendingPatch.content}
          note={pendingPatch.description}
          onApply={acceptPatch}
          onReject={() => setPendingPatch(null)}
        />
      )}

      {/* Header */}
      <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)',
        background:'var(--surface)', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <span style={{ fontSize:16, filter:'drop-shadow(0 0 6px var(--violet))' }}>⬢</span>
        <div>
          <span className="title-glow" style={{ fontSize:14 }}>RĀMA IDE</span>
          <span style={{ fontSize:10, color:'var(--muted)', marginLeft:10 }}>
            Supreme AGI Code Editor · Monaco · Multi-model AI · Online Research
          </span>
        </div>
        {activeTab && (
          <span style={{ fontSize:11, color: activeTab.dirty ? 'var(--amber)' : 'var(--muted)', marginLeft:8 }}>
            {activeTab.file.name}{activeTab.dirty ? ' ●' : ''}
          </span>
        )}
        <div style={{ flex:1 }} />
        {['split','editor','ai'].map(l => (
          <button key={l} className="btn btn-sm" onClick={() => setLayout(l)} style={{
            fontSize:10, padding:'3px 8px',
            borderColor: layout===l ? 'var(--violet)' : 'var(--border)',
            color: layout===l ? 'var(--violet)' : 'var(--muted)',
          }}>{l}</button>
        ))}
        <button className="btn btn-sm" onClick={() => setShowNewProject(true)}
                style={{ fontSize:12 }} title="Create a project Rāma will already know about">
          ✚ New project
        </button>
        {activeTab && <button className="btn btn-sm" onClick={saveFile} style={{ fontSize:12 }}>💾 Save</button>}
      </div>

      {/* Tab bar */}
      {tabs.length > 0 && (
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', background:'var(--surface)',
          overflowX:'auto', flexShrink:0, scrollbarWidth:'none' }}>
          {tabs.map(tab => (
            <div key={tab.id} onClick={() => setActiveTabId(tab.id)} style={{
              display:'flex', alignItems:'center', gap:6, padding:'6px 14px',
              cursor:'pointer', fontSize:11, flexShrink:0, whiteSpace:'nowrap',
              background: tab.id===activeTabId ? 'rgba(0,200,255,0.06)' : 'transparent',
              borderBottom: tab.id===activeTabId ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab.id===activeTabId ? 'var(--accent)' : 'var(--text-dim)',
            }}>
              <span>{getFileIcon(tab.file?.name, false)}</span>
              <span>{tab.file?.name}</span>
              {tab.dirty && <span style={{ color:'var(--amber)', fontSize:10 }}>●</span>}
              <button onClick={e => { e.stopPropagation(); closeTab(tab.id); }} style={{
                background:'none', border:'none', color:'var(--muted)', cursor:'pointer',
                fontSize:10, padding:'0 2px', fontFamily:'var(--font)',
              }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
        {/* File tree */}
        <div style={{ width:200, flexShrink:0, overflow:'hidden' }}>
          <FileTree onFileOpen={openFile} activeFile={activeTab?.file} openDir={newProjectDir} />
        </div>

        {/* Editor */}
        {(layout==='split'||layout==='editor') && (
          <div style={{ flex:1, overflow:'hidden', minWidth:0, display:'flex', flexDirection:'column' }}>
            {activeTab ? (
              <>
                {/* A real editor now. CodeEditor falls back to a textarea only if Monaco itself
                    fails to start, and says so on screen rather than showing an empty panel. */}
                <div style={{ flex:1, overflow:'hidden', position:'relative' }}>
                  <CodeEditor
                    path={activeTab.file?.path || activeTab.file?.name || 'untitled'}
                    value={activeTab.content}
                    onChange={onContentChange}
                    onSave={saveFile}
                  />
                </div>
                <ASTPanel astData={astData} loading={astLoading} />
              </>
            ) : (
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
                flexDirection:'column', gap:12, color:'var(--muted)' }}>
                <span style={{ fontSize:32, filter:'drop-shadow(0 0 8px var(--violet))' }}>⬢</span>
                <span style={{ fontSize:12 }}>Open a file from the tree</span>
                <span style={{ fontSize:10 }}>Monaco editor loads automatically</span>
              </div>
            )}
          </div>
        )}

        {/* AI Panel */}
        {(layout==='split'||layout==='ai') && (
          <div style={{ width: layout==='ai' ? '100%' : 380, flexShrink:0, overflow:'hidden', minWidth:0 }}>
            <AIPanel
              currentFile={activeTab?.file}
              currentContent={activeTab?.content}
              astData={astData}
              onApplyPatch={handlePatch}
            />
          </div>
        )}
      </div>
    </div>
  );
}

