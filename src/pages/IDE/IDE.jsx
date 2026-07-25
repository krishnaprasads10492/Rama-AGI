import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRamaStore } from '@store/ramaStore.js';
import { ramaChat }     from '@services/ramaClient.js';
import { getSystemPrompt } from '@services/consciousness.js';
import { emitActivity } from '@components/ActivityStream.jsx';

const isElectron = typeof window !== 'undefined' && !!window.rama;

/**
 * Rāma IDE — Sub-model expressing Supreme AGI coding capability.
 *
 * Features:
 *   - File tree (full filesystem navigation)
 *   - Multi-tab code editor (Monaco via CDN)
 *   - AI pair programmer (full repo context, generate/patch/review)
 *   - Integrated terminal
 *   - Diff viewer (before/after)
 *   - Create new apps from natural language
 *   - Edit Rāma's own codebase
 *   - All changes go through master approval before writing
 */

// ─── Language detection ───────────────────────────────────────────────────────
function detectLanguage(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', json: 'json', md: 'markdown', css: 'css', html: 'html',
    sh: 'shell', bash: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'toml',
    rs: 'rust', go: 'go', java: 'java', cpp: 'cpp', c: 'c', cs: 'csharp',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', r: 'r',
    sql: 'sql', xml: 'xml', cjs: 'javascript', mjs: 'javascript',
  };
  return map[ext] || 'plaintext';
}

function getFileIcon(name, isDir) {
  if (isDir) return '📁';
  const ext = (name || '').split('.').pop().toLowerCase();
  const icons = {
    js: '🟨', jsx: '⚛', ts: '🔷', tsx: '⚛', py: '🐍', json: '{}',
    md: '📝', css: '🎨', html: '🌐', sh: '⬢', cjs: '🟨', yml: '⚙',
    yaml: '⚙', rs: '🦀', go: '🐹', env: '🔒', enc: '🔐', sql: '🗃',
  };
  return icons[ext] || '📄';
}

// ─── File Tree ─────────────────────────────────────────────────────────────────
function FileTree({ rootPath, onFileOpen, activeFile }) {
  const [tree,     setTree]     = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [loading,  setLoading]  = useState(false);
  const [cwd,      setCwd]      = useState(rootPath || '');

  const listDir = useCallback(async (path) => {
    if (!isElectron || !path) return [];
    const res = await window.rama.fs.listDir(path);
    return res.ok ? res.data : [];
  }, []);

  useEffect(() => {
    if (!cwd) return;
    setLoading(true);
    listDir(cwd).then(items => { setTree(items); setLoading(false); });
  }, [cwd, listDir]);

  const toggle = useCallback(async (item) => {
    if (!item.isDir) { onFileOpen(item); return; }
    const key = item.path;
    const next = new Set(expanded);
    if (next.has(key)) { next.delete(key); }
    else { next.add(key); }
    setExpanded(next);
  }, [expanded, onFileOpen]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Path bar */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex',
        alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <input className="input" value={cwd} onChange={e => setCwd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && listDir(cwd).then(setTree)}
          style={{ fontSize: 10, padding: '3px 8px' }} placeholder="Path..." />
        {isElectron && (
          <button className="btn btn-sm" style={{ fontSize: 10, padding: '3px 8px', flexShrink: 0 }}
            onClick={async () => {
              const res = await window.rama.fs.selectPath({ directory: true });
              if (!res.canceled) { setCwd(res.paths[0]); }
            }}>📁</button>
        )}
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading ? (
          <div style={{ padding: 12, color: 'var(--muted)', fontSize: 11 }}>Loading...</div>
        ) : tree.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--muted)', fontSize: 11 }}>
            {cwd ? 'Empty directory' : 'Open a folder to start'}
          </div>
        ) : (
          <TreeItems items={tree} depth={0} expanded={expanded} onToggle={toggle}
            activeFile={activeFile} listDir={listDir} />
        )}
      </div>
    </div>
  );
}

function TreeItems({ items, depth, expanded, onToggle, activeFile, listDir }) {
  const [childMap, setChildMap] = useState({});

  const loadChildren = useCallback(async (path) => {
    if (childMap[path]) return;
    const children = await listDir(path);
    setChildMap(m => ({ ...m, [path]: children }));
  }, [childMap, listDir]);

  return (
    <>
      {items.map(item => {
        const isExp = expanded.has(item.path);
        if (item.isDir && isExp && !childMap[item.path]) {
          loadChildren(item.path);
        }
        const isActive = activeFile?.path === item.path;
        return (
          <React.Fragment key={item.path}>
            <div onClick={() => onToggle(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: `3px 10px 3px ${10 + depth * 14}px`,
                cursor: 'pointer', fontSize: 11,
                background: isActive ? 'rgba(0,255,255,0.08)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-dim)',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(0,255,255,0.03)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 12, flexShrink: 0 }}>{getFileIcon(item.name, item.isDir)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
              </span>
              {item.isDir && (
                <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 'auto' }}>
                  {isExp ? '▾' : '▸'}
                </span>
              )}
            </div>
            {item.isDir && isExp && childMap[item.path] && (
              <TreeItems items={childMap[item.path]} depth={depth + 1} expanded={expanded}
                onToggle={onToggle} activeFile={activeFile} listDir={listDir} />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// ─── Code editor (textarea-based, Monaco in Phase 5) ─────────────────────────
function CodeEditor({ file, content, onChange, onSave }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.value = content || '';
  }, [content]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0, padding: '0 8px' }}>
        {file ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            color: 'var(--accent)', fontSize: 11, borderBottom: '2px solid var(--accent)' }}>
            <span>{getFileIcon(file.name, false)}</span>
            <span>{file.name}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              {detectLanguage(file.name)}
            </span>
          </div>
        ) : (
          <span style={{ padding: '7px 14px', color: 'var(--muted)', fontSize: 11 }}>No file open</span>
        )}
        <div style={{ flex: 1 }} />
        {file && (
          <button className="btn btn-sm" style={{ fontSize: 10 }} onClick={onSave}>
            💾 Save
          </button>
        )}
      </div>

      {/* Editor */}
      {file ? (
        <textarea
          ref={textareaRef}
          spellCheck={false}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSave(); }
          }}
          style={{
            flex: 1, resize: 'none', outline: 'none', border: 'none',
            background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.7,
            padding: 16, tabSize: 2,
            overflowY: 'auto',
          }}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12, color: 'var(--muted)' }}>
          <span style={{ fontSize: 32 }}>⬢</span>
          <span style={{ fontSize: 12 }}>Open a file from the tree to start editing</span>
        </div>
      )}
    </div>
  );
}

// ─── AI Panel ─────────────────────────────────────────────────────────────────
function AIPanel({ currentFile, currentContent, repoPath, onApplyPatch }) {
  const [prompt,   setPrompt]   = useState('');
  const [response, setResponse] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [mode,     setMode]     = useState('chat');   // chat | generate | patch | review | scaffold
  const { provider, model }    = useRamaStore();

  const MODES = [
    { id: 'chat',     label: 'Chat',     icon: '◈', desc: 'Ask anything about the code' },
    { id: 'patch',    label: 'Patch',    icon: '⬡', desc: 'Fix or improve current file' },
    { id: 'generate', label: 'Generate', icon: '⚡', desc: 'Generate new code from description' },
    { id: 'review',   label: 'Review',   icon: '◉', desc: 'Full code review & suggestions' },
    { id: 'scaffold', label: 'Scaffold', icon: '⬢', desc: 'Create new app or project' },
  ];

  const run = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    emitActivity('thinking', `IDE: ${mode} — ${prompt.slice(0, 40)}...`);

    const systemBase = getSystemPrompt();
    const fileCtx = currentFile
      ? `\n\nCurrent file: ${currentFile.path}\nLanguage: ${detectLanguage(currentFile.name)}\n\nContent:\n\`\`\`\n${(currentContent || '').slice(0, 8000)}\n\`\`\``
      : '';

    const modePrompts = {
      chat:     `You are Rāma IDE's AI coding assistant. Answer the question directly.${fileCtx}`,
      patch:    `You are Rāma IDE. Patch or improve the code as requested. Return ONLY the complete updated file content inside triple backticks. No explanations outside the code block.${fileCtx}`,
      generate: `You are Rāma IDE. Generate the requested code. Return complete, production-ready code inside triple backticks with the file language.`,
      review:   `You are Rāma IDE. Perform a thorough code review. Cover: correctness, security, performance, readability, best practices, potential bugs. Be specific with line references.${fileCtx}`,
      scaffold: `You are Rāma IDE. Scaffold the requested application. Provide a complete file structure with all key files. For each file, provide the full content inside a code block labeled with the file path.`,
    };

    const messages = [
      { role: 'system', content: systemBase + '\n\n' + modePrompts[mode] },
      { role: 'user',   content: prompt },
    ];

    const res = await ramaChat.send({ messages, provider, model, sessionId: `ide_${Date.now()}` });
    setLoading(false);

    if (res.ok && res.message) {
      setResponse(res.message.content);
      emitActivity('complete', `IDE ${mode} complete`);

      // Auto-extract patch if mode is 'patch'
      if (mode === 'patch') {
        const codeMatch = res.message.content.match(/```[\w]*\n([\s\S]+?)```/);
        if (codeMatch) {
          onApplyPatch?.(codeMatch[1], `IDE patch: ${prompt.slice(0, 50)}`);
        }
      }
    } else {
      setResponse(`Error: ${res.error || 'No response'}`);
    }
  }, [prompt, loading, mode, currentFile, currentContent, provider, model, onApplyPatch]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      borderLeft: '1px solid var(--border)' }}>
      {/* Mode selector */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        flexShrink: 0, overflowX: 'auto', padding: '0 4px' }}>
        {MODES.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} title={m.desc} style={{
            padding: '8px 10px', border: 'none', background: 'transparent',
            color: mode === m.id ? 'var(--violet)' : 'var(--muted)',
            borderBottom: mode === m.id ? '2px solid var(--violet)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0,
          }}>
            <span style={{ fontSize: 13 }}>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* Response */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, minHeight: 0 }}>
        {response ? (
          <pre style={{ fontFamily: 'var(--font)', fontSize: 11, color: 'var(--text)', lineHeight: 1.7,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
            {response}
          </pre>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>◈</div>
            <div>Rāma IDE AI is ready.</div>
            <div style={{ marginTop: 6, fontSize: 10 }}>
              {MODES.find(m => m.id === mode)?.desc}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: 10, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <textarea className="input" rows={3} value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
          placeholder={
            mode === 'patch'    ? 'Describe what to fix or improve...' :
            mode === 'generate' ? 'Describe the code to generate...' :
            mode === 'review'   ? 'Press Enter to review current file...' :
            mode === 'scaffold' ? 'Describe the app to create...' :
            'Ask about the code...'
          }
          style={{ resize: 'none', marginBottom: 8, fontSize: 12 }} />
        <button className="btn btn-primary btn-sm" disabled={!prompt.trim() || loading}
          onClick={run} style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? 'Thinking...' : `◈ ${MODES.find(m => m.id === mode)?.label}`}
        </button>
      </div>
    </div>
  );
}

// ─── Diff viewer ───────────────────────────────────────────────────────────────
function DiffViewer({ original, modified, onAccept, onReject }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600 }}>
      <div className="hud-card" style={{ width: '80vw', maxHeight: '80vh', display: 'flex',
        flexDirection: 'column', padding: 20, gap: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.08em' }}>
            ⚡ PROPOSED CHANGE — Review before applying
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 1, overflow: 'hidden' }}>
          <div>
            <div className="section-label" style={{ marginBottom: 6, color: 'var(--red)' }}>BEFORE</div>
            <pre style={{ background: 'var(--surface)', border: '1px solid rgba(255,0,60,0.3)',
              borderRadius: 'var(--radius)', padding: 12, overflow: 'auto', height: '50vh',
              fontSize: 11, fontFamily: 'var(--font)', color: 'var(--text-dim)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
              {(original || '').slice(0, 3000)}
            </pre>
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 6, color: 'var(--green)' }}>AFTER</div>
            <pre style={{ background: 'var(--surface)', border: '1px solid rgba(0,255,65,0.3)',
              borderRadius: 'var(--radius)', padding: 12, overflow: 'auto', height: '50vh',
              fontSize: 11, fontFamily: 'var(--font)', color: 'var(--text)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
              {(modified || '').slice(0, 3000)}
            </pre>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-danger" onClick={onReject}>✕ Reject</button>
          <button className="btn btn-sm btn-primary" onClick={onAccept}>✓ Accept & Write</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main IDE page ────────────────────────────────────────────────────────────
export default function IDE() {
  const [repoPath,    setRepoPath]    = useState('');
  const [activeFile,  setActiveFile]  = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [modified,    setModified]    = useState(false);
  const [pendingPatch,setPendingPatch]= useState(null);   // { content, description }
  const [showDiff,    setShowDiff]    = useState(false);
  const [aiWidth,     setAiWidth]     = useState(360);
  const [layout,      setLayout]      = useState('split'); // split | editor | ai

  const openFile = useCallback(async (item) => {
    if (!isElectron) {
      setActiveFile(item);
      setFileContent(`// ${item.name}\n// File loading requires Electron`);
      setModified(false);
      return;
    }
    const res = await window.rama.fs.readFile(item.path);
    if (res.ok) {
      setActiveFile(item);
      setFileContent(res.content);
      setModified(false);
    }
  }, []);

  const saveFile = useCallback(async () => {
    if (!activeFile || !isElectron) return;
    const res = await window.rama.fs.writeFile(activeFile.path, fileContent);
    if (res.ok) {
      setModified(false);
      emitActivity('complete', `Saved: ${activeFile.name}`);
    }
  }, [activeFile, fileContent]);

  const handlePatch = useCallback((patchedContent, description) => {
    setPendingPatch({ content: patchedContent, description });
    setShowDiff(true);
  }, []);

  const acceptPatch = useCallback(async () => {
    if (!pendingPatch) return;
    setFileContent(pendingPatch.content);
    setModified(true);
    setShowDiff(false);
    setPendingPatch(null);
    // Auto-save
    if (activeFile && isElectron) {
      await window.rama.fs.writeFile(activeFile.path, pendingPatch.content);
      setModified(false);
    }
  }, [pendingPatch, activeFile]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {showDiff && pendingPatch && (
        <DiffViewer
          original={fileContent}
          modified={pendingPatch.content}
          onAccept={acceptPatch}
          onReject={() => { setShowDiff(false); setPendingPatch(null); }}
        />
      )}

      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 16 }}>⬢</span>
        <div>
          <span style={{ fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em' }}>RĀMA IDE</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 10 }}>
            Supreme AGI Code Editor
          </span>
        </div>
        {activeFile && (
          <span style={{ fontSize: 11, color: modified ? 'var(--amber)' : 'var(--muted)', marginLeft: 8 }}>
            {activeFile.path}{modified ? ' •' : ''}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Layout toggles */}
        {['split', 'editor', 'ai'].map(l => (
          <button key={l} className="btn btn-sm" onClick={() => setLayout(l)}
            style={{ borderColor: layout === l ? 'var(--violet)' : 'var(--border)',
              color: layout === l ? 'var(--violet)' : 'var(--muted)', fontSize: 10, padding: '3px 8px' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* File tree — always visible */}
        <div style={{ width: 220, borderRight: '1px solid var(--border)', flexShrink: 0, overflow: 'hidden' }}>
          <FileTree rootPath={repoPath} onFileOpen={openFile} activeFile={activeFile} />
        </div>

        {/* Editor */}
        {(layout === 'split' || layout === 'editor') && (
          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            <CodeEditor
              file={activeFile}
              content={fileContent}
              onChange={content => { setFileContent(content); setModified(true); }}
              onSave={saveFile}
            />
          </div>
        )}

        {/* AI Panel */}
        {(layout === 'split' || layout === 'ai') && (
          <div style={{ width: layout === 'ai' ? '100%' : aiWidth, flexShrink: 0, overflow: 'hidden', minWidth: 0 }}>
            <AIPanel
              currentFile={activeFile}
              currentContent={fileContent}
              repoPath={repoPath}
              onApplyPatch={handlePatch}
            />
          </div>
        )}
      </div>
    </div>
  );
}
