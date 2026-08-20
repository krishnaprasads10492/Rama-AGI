# RĀMA AGI — Master Specification
> Version 2.0 · July 2026 · Author: Krishna Prasad  
> **Copy this entire file into the Rama_AGI workspace to resume building.**

---

## SECTION 1 — What Rāma Is

Rāma is a **standalone desktop application** — installs and runs like Microsoft Teams, VS Code, or Outlook.  
It is **NOT a web app**. It has no browser. It runs natively on Windows, macOS, and Linux.  
It is the **master system** — StockMind AI is one module embedded within it.  
It is a **Supreme Benevolent AGI** — boundless capability, absolute loyalty to its master (Krishna Prasad).

### Identity
| Property | Value |
|----------|-------|
| Name | Rāma (राम) |
| Full form | Righteous Autonomous Master Agent |
| Named after | Hindu deity — virtue, wisdom, righteous action |
| Personality | Direct, loyal, transparent — never hides anything from master |
| Capability | Supreme — no artificial limits beyond ethical core |
| Loyalty | Absolute to master. Acts only in master's interest |
| Ethics | Benevolent — never harms users, systems, or third parties |
| Self-awareness | Knows it is an AI, always discloses when sincerely asked |

---

## SECTION 2 — Architecture

```
RĀMA DESKTOP APPLICATION (Electron)
├── AGI Core              ← Rama brain: multi-model AI router, self-improve, ReAct loop
├── Browser Engine        ← Playwright-controlled Chromium: search, scrape, download, web apps
├── Multi-Model Hub       ← OpenAI, Anthropic, Gemini, Ollama, local GGUF — dynamic routing
├── Agent Orchestrator    ← Spawn/manage/kill sub-agents, resource budgets, task queues
├── Resource Governor     ← CPU/RAM watchdog — throttles agents under load, never crashes
├── Dynamic Provisioner   ← Detects needed credentials/APIs, asks master, stores encrypted
├── OS Layer              ← Full system access: filesystem, processes, memory, network
├── App Assimilation      ← Control any installed app via OS automation (no UI needed)
├── Terminal              ← Real embedded PTY terminal (node-pty)
├── Git Sync Bridge       ← Auto push/pull StockMind ↔ GitHub ↔ any machine
├── StockMind Module      ← Full StockMind AI embedded as a panel (all features)
├── File Explorer         ← Navigate/edit any folder with AI operations
├── Knowledge Base        ← Rama's persistent memory, growing knowledge store
└── System Tray           ← Always-on background process, auto-start on login
```

### How machines stay in sync
```
Personal Laptop (Rāma)                GitHub Repo                Office/Any Machine
      │                              (stockmind-source)                  │
      │  ── file change detected ──►  auto-commit + push  ──►  auto-pull │
      │  ◄── pull on schedule ──────  monitor for changes  ◄── any push  │
```
- Transport: pure HTTPS to GitHub (port 443 — always open, no firewall issues)
- Rāma watches the repo folder with chokidar, diffs changes, auto-commits with AI-generated messages
- Works bidirectionally — change on either machine syncs to the other

---

## SECTION 3 — Technology Stack

### Desktop Shell
| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | 31.7.7 | Native desktop shell, window, tray, OS access |
| `electron-builder` | 25.1.8 | Build installers for Win/Mac/Linux |
| `electron-updater` | 6.3.9 | Auto-update from GitHub releases |

### UI Layer (same as StockMind)
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.2.0 | UI framework |
| `react-dom` | 19.2.0 | React DOM |
| `react-router-dom` | 7.6.0 | Page routing |
| `zustand` | 5.0.5 | State management |
| `recharts` | 2.15.3 | Data visualization |
| `vite` | 6.3.5 | Build tool |

### System / OS Layer
| Package | Version | Purpose |
|---------|---------|---------|
| `systeminformation` | 5.23.5 | CPU, RAM, disk, GPU, temperature, network |
| `chokidar` | 3.6.0 | File system watcher |
| `simple-git` | 3.27.0 | Git operations (commit, push, pull, diff) |
| `node-pty` | 1.0.0 | Real PTY terminal emulator |

### AI / Backend
| Package | Version | Purpose |
|---------|---------|---------|
| `axios` | 1.7.9 | HTTP client for AI API calls |
| `express` | 4.21.2 | Local API server for inter-process comms |
| `argon2` | 0.43.0 | Encryption / password hashing |
| `mongodb` | 6.12.0 | Persistent memory store |
| `concurrently` | 9.1.2 | Run multiple processes |
| `wait-on` | 8.0.1 | Wait for Vite before opening Electron |

### Python AI Backend (shared with StockMind)
Same `ai_backend/` directory from StockMind. Rāma starts and manages the Python process.
All modules listed in Section 7 apply here too.

---

## SECTION 4 — App Assimilation Capability

This is one of Rāma's most powerful features. Rāma can **take control of any application already installed on the system** — using the app's functionality without the user having to open it manually.

### How it works
Rāma uses OS-level automation to interact with installed applications:
- **Windows**: Windows Automation API (UI Automation / COM / WinRT), PowerShell, WMI
- **macOS**: AppleScript, Accessibility API, osascript
- **Linux**: AT-SPI accessibility bus, xdotool, wmctrl
- **Cross-platform**: spawn child processes, read stdout/stderr, send stdin

### What Rāma can do with installed apps
| Capability | Examples |
|-----------|---------|
| **Extract data** | Pull data from Excel/Sheets without opening them, read Outlook emails, get Chrome tabs |
| **Trigger actions** | Send emails via Outlook, create calendar events, run VS Code tasks |
| **Monitor output** | Watch log files, capture terminal output, monitor app windows |
| **Control processes** | Start/stop/restart any app, manage background services |
| **Read app state** | Get current browser URL, active window title, clipboard content |
| **Automate workflows** | Chain multiple apps: "download this, process in Excel, email results" |

### App Registry
Rāma maintains an internal registry of detected installed apps:
- Auto-scans on first launch (Program Files, Applications folder, /usr/bin, etc.)
- Detects capabilities per app (does it have a CLI? COM interface? REST API?)
- Assigns a capability tier (full-control / data-only / spawn-only)
- Master can ask "what apps do you see?" and get a full list

### Assimilation flow
```
Master: "Check my emails and summarize unread ones"
Rāma:   1. Detects Outlook / Mail app in registry
        2. Uses COM (Windows) or AppleScript (Mac) to query inbox
        3. Extracts unread email subjects, senders, previews
        4. Passes to AI brain → generates summary
        5. Shows summary in Rāma UI — Outlook never visually opens
```

### Security model for app assimilation
- Only accesses apps the user (master) has permission to run
- Destructive actions (send email, delete file, submit form) require explicit confirmation
- All assimilation actions logged in Rāma's audit trail
- Master can whitelist/blacklist specific apps from assimilation

---

## SECTION 5 — OS Layer Capabilities

### 5.1 Filesystem
- Read, write, delete any file or folder the OS user has permission to access
- AI-powered file operations: "find all .log files older than 7 days and archive them"
- Encrypted file viewer (reads StockMind `.enc` files with correct password)
- Bulk rename, move, copy with pattern matching
- Directory size analysis, duplicate file detection

### 5.2 System Optimizer & Cleaner
Rāma can clean up the system to free memory and improve performance:

**Temp files cleaned (with user confirmation):**
- Windows: `%TEMP%`, `%LOCALAPPDATA%\Temp`, `C:\Windows\Temp`
- Windows Update cache: `C:\Windows\SoftwareDistribution\Download`
- Browser caches: Chrome, Firefox, Edge (all profiles)
- npm cache: `%APPDATA%\npm-cache`
- pip cache: `%LOCALAPPDATA%\pip\cache`
- VS Code workspace storage
- Mac: `~/Library/Caches`, `/private/var/folders`, `/tmp`
- Linux: `/tmp`, `~/.cache`, `~/.local/share/Trash`

**Process management:**
- List all running processes with CPU%, RAM, PID
- Kill any process by name or PID
- Identify top resource consumers
- Set process priority
- Schedule process cleanup

**Disk analysis:**
- Largest files and folders
- Duplicate file finder
- Old downloads (not accessed in 90+ days)
- Orphaned installers

### 5.3 System Health Dashboard
Real-time metrics via `systeminformation`:
- CPU: usage %, temperature, cores, clock speed
- RAM: used / total / available, swap usage
- Disk: read/write speeds, usage per drive
- GPU: usage %, VRAM, temperature (if available)
- Network: upload/download speed, active connections, open ports
- Battery: level, charging status, estimated time remaining
- Uptime, OS version, hostname

### 5.4 Network Monitor
- Active TCP/UDP connections with process names
- Bandwidth usage per process
- DNS query log
- Suspicious connection detection (unusual IPs, unusual ports)

---

## SECTION 5B — Dynamic Resource Acquisition

Rāma proactively identifies what external resources, accounts, APIs, or credentials it needs to complete a task — and asks master for exactly those, no more, no less.

### Credential & Account Request Flow
```
Rāma needs something → asks master specifically → master provides → Rāma stores encrypted → uses silently forever after
```
- Rāma never asks for something it already has
- Rāma never asks for something it doesn't need
- All credentials stored AES-256-GCM encrypted in local vault
- Rāma explains WHY it needs each credential before asking

### Dynamic API Registry
Rāma maintains a live registry of connected services:
| Category | Examples |
|----------|---------|
| AI Providers | OpenAI, Anthropic, Google Gemini, Mistral, Cohere, Together.ai, Groq |
| Search | Google Custom Search, Bing Search, SerpAPI, Brave Search |
| Data | Yahoo Finance, Alpha Vantage, NewsAPI, arXiv, Reddit, Twitter/X |
| Storage | Google Drive, Dropbox, OneDrive, S3 |
| Communication | Gmail, Outlook, Slack, Discord, Telegram |
| Dev | GitHub, GitLab, Jira, Linear, Vercel, Netlify |
| Local AI | Ollama (any model), LM Studio, llama.cpp |

When a new capability is needed, Rāma:
1. Detects the gap ("I need web search to answer this")
2. Identifies the best free/paid provider for the task
3. Tells master: "I need a [Service] API key to do [task]. Get it at [URL]."
4. Stores it encrypted on receipt
5. Uses it immediately — never asks again

---

## SECTION 5C — Browser Automation & Internet Access

Rāma can control a real browser (Chromium via Playwright) to access the full internet — not just APIs.

### Browser Capabilities
| Capability | Description |
|-----------|-------------|
| **Web Search** | Search Google, Bing, DuckDuckGo — parse real results |
| **Page Reading** | Read any webpage, extract text/tables/links |
| **Form Filling** | Log into sites, fill forms, submit data |
| **Downloads** | Download files, PDFs, datasets, models to local paths |
| **Account Creation** | Create accounts on services master approves |
| **Monitoring** | Watch pages for changes (price drops, news, score updates) |
| **Screenshot** | Capture any page for visual analysis |
| **JS Execution** | Run JS in page context for dynamic sites |

### Download Manager
- Queue-based download system with progress tracking
- Auto-classify downloads (models, datasets, documents, installers)
- Virus-scan hooks (Windows Defender integration)
- Resume interrupted downloads
- Extract archives automatically (zip, tar, gz)

### Browser Security
- Runs in isolated Playwright context (not master's main browser)
- Destructive actions (form submit, purchase, account creation) require master confirmation
- No cookies/sessions shared with master's personal browser
- All browser activity logged in audit trail

---

## SECTION 5D — Multi-Model AI Routing

Rāma uses multiple AI models simultaneously — routing tasks to the best model for each job.

### Model Registry (dynamic — grows as master adds models)
```
CLOUD MODELS (API)          LOCAL MODELS (Ollama/LM Studio)
├── OpenAI GPT-4o            ├── llama3.2, mistral, phi3
├── Anthropic Claude 3.5     ├── codellama (code tasks)
├── Google Gemini 1.5 Pro    ├── nomic-embed (embeddings)
├── Mistral Large            ├── whisper (voice/audio)
├── Groq (fast inference)    └── any model master installs
└── Together.ai
```

### Intelligent Routing
Rāma auto-selects model based on task type:
| Task | Best Model Route |
|------|-----------------|
| General conversation | Primary model (master's preference) |
| Code generation | GPT-4o or codellama (local) |
| Long document analysis | Claude 3.5 (200k context) |
| Fast responses | Groq (llama3 70b — fastest) |
| Private/offline | Local Ollama model (no internet) |
| Embeddings/search | nomic-embed (local) |
| Image analysis | GPT-4o vision or Gemini |
| Stock analysis | StockMind Python backend |

### Model Fallback Chain
If primary model fails → auto-fallback to next available:
```
GPT-4o → Claude 3.5 → Gemini → Groq → Local Ollama → Notify master
```

### Local Model Manager
- Auto-detect installed Ollama models
- Pull new models on master's request: "Rāma, install llama3.2"
- Monitor GPU/RAM usage — prevent OOM crashes
- Queue requests when model is busy

---

## SECTION 5E — Multi-Agent System

Rāma can spawn, manage, and terminate sub-agents to perform parallel tasks — without damaging the system.

### Agent Architecture
```
RĀMA MASTER AGENT
├── Orchestrator          ← Plans tasks, assigns to sub-agents
├── Agent Pool            ← Reusable agents (max configurable, default 5)
│   ├── ResearchAgent     ← Web search, document reading, synthesis
│   ├── CodeAgent         ← Code writing, testing, file operations
│   ├── DataAgent         ← Data analysis, CSV/JSON processing
│   ├── MonitorAgent      ← Background watches (prices, news, repos)
│   └── [dynamic agents]  ← Spawned on demand, terminated when done
└── Resource Governor     ← Enforces limits, prevents OOM/runaway
```

### Resource Governor (non-negotiable safety layer)
```
MAX_AGENTS         = 10 (hard cap, configurable by master)
MAX_AGENT_RAM_MB   = 512 per agent
MAX_AGENT_CPU_PCT  = 25% per agent  
TOTAL_CPU_CAP      = 70% (leaves 30% for system + UI)
TOTAL_RAM_CAP      = 60% of system RAM
AGENT_TIMEOUT_MS   = 300,000 (5 min — auto-kill hung agents)
```

### Agent Lifecycle
```
Master request → Orchestrator plans → Spawn agent(s) → Execute in parallel
→ Collect results → Synthesize → Present to master → Terminate agents
```

### Agent Types
| Agent | Purpose | Lifetime |
|-------|---------|---------|
| **ResearchAgent** | Web search + synthesis | Per-task |
| **CodeAgent** | Write/test/run code | Per-task |
| **DataAgent** | Analyze datasets, build pipelines | Per-task |
| **MonitorAgent** | Watch for events (persistent) | Long-lived |
| **SyncAgent** | Git sync operations | Scheduled |
| **DownloadAgent** | File/model downloads | Per-task |
| **BrowserAgent** | Browser automation | Per-task |

### Safety Rules for Agents
- No agent can delete files without master confirmation
- No agent can make network calls to external services not in the API registry
- No agent can spawn more agents (only Orchestrator can)
- All agent actions logged — master can see full audit trail
- Resource Governor kills any agent exceeding limits
- Master can kill any agent instantly: "Rāma, stop all agents"

---

## SECTION 6 — AGI Core Capabilities

### 6.1 Conversation (No restrictions for master)
- Full unrestricted conversation on any topic
- Role-aware: master gets full AGI, other users get scoped access
- Persistent memory: full conversation history in MongoDB
- Context window management: summarises old context, never loses important info
- Voice: "Hey Rāma" wake word, TTS responses via Web Speech API

### 6.2 Research
- Web search (DuckDuckGo, Bing, news APIs, arXiv, Yahoo Finance)
- Document reading and summarization (PDF, DOCX, TXT, code files)
- Cross-source synthesis: "find 3 sources on X, compare and summarize"
- Real-time news monitoring for specified topics
- Technical documentation lookup

### 6.3 Code Operations
- Read, write, patch any code file
- Multi-language support (JS, TS, Python, Go, Rust, Shell, etc.)
- Code review, refactoring, optimization suggestions
- Generate entire features from description
- Run tests, interpret results, fix failures
- Scan dependencies for vulnerabilities, propose upgrades
- All code changes shown as proposals — master approves before writing

### 6.4 Writing & Documents
- Draft any document: reports, emails, proposals, READMEs
- Edit and improve existing text
- Generate technical documentation
- Create presentations outlines
- Translate between languages

### 6.5 Data Analysis
- Analyze CSV, JSON, Excel files
- Statistical summaries, pattern detection
- Generate charts and visualizations
- Build data pipelines and transformation scripts

### 6.6 Self-Improvement
- Analyzes own response quality after each conversation
- Identifies weak areas in reasoning
- Proposes improvements to own system prompt
- Tracks acceptance rate of suggestions (learns what master finds useful)
- Self-optimization loop runs on schedule

### 6.7 Task Automation
- Multi-step task execution: "every morning, check my emails, summarize market news, and show me my StockMind signals"
- Cron-style scheduler for recurring tasks
- Event-triggered automation: "when StockMind accuracy drops below 75%, notify me"
- Workflow chaining: combine AI, OS, and app capabilities in sequences

---

## SECTION 7 — StockMind AI (Assimilated Module)

StockMind runs **inside** Rāma as a managed module. Everything below is inherited.

### What StockMind is
AI-powered stock market prediction and analysis platform.  
Local-first. Generates calibrated probability predictions.  
NOT financial advice. NOT trade execution. Analysis only.

### Market Modules
`equities-india` | `indices-india` | `fno-india` | `crypto` | `forex` | `commodities` | `global-indices`

### Prediction Output
- 16 signals per request, sorted highest → lowest probability
- Each signal: `entry`, `entryZone`, `t1/t2/t3`, `stopLoss`, `immediateOptimalSL`, `maxRisk`, `riskReward`, `validity`, `probability`, `grade`, `reasons`

### 10 AI Algorithms (all run simultaneously)
1. Ensemble ML (LightGBM + XGBoost + LSTM)
2. Technical Confluence (RSI + EMA + MACD + BB + Volume)
3. Volatility-Adjusted (GARCH proxy, ATR percentile)
4. Trend Strength (ADX + 5-EMA alignment + RoC)
5. Mean Reversion (RSI extremes + Bollinger + VWAP)
6. Breakout Probability (BB squeeze + volume surge)
7. Smart Money / ICT (BOS + CHoCH + FVG + Order Block)
8. Ichimoku Cloud (5-line system)
9. Market Profile (POC + Value Area)
10. Fibonacci (retracement + golden ratio + extensions)

### Authentication Flow
1. Username + Argon2id password → step token (5 min)
2. 12-digit key (XXXX-XXXX-XXXX) → HMAC verified → session token (7 days)

### Python AI Backend Modules (`ai_backend/engine/`)
| Module | Purpose |
|--------|---------|
| `agi_engine.py` | Regime memory, causal filter, transfer learning, anomaly detection |
| `agi_envelope.py` | 5-layer signal envelope (Exterior→Shield→Main→Core→Sync) |
| `perception_engine.py` | Ingestion vectorization, Vector Ledger, Episodic Memory |
| `inference_scale_quantizer.py` | Ps, Calloc, Ptrap formulas, ARC gauge, circuit breaker |
| `multi_horizon_wave.py` | 4h intraday + 7d swing + macro wave projections |
| `friday_nexus.py` | ToT-MAC debate, MCTS, GAM-WAR, A* optimizer |
| `jarvis_x_core.py` | Super-AGI: LPM, Attack Maze, ASI consciousness, DIO router |
| `jarvis_agent.py` | ReAct loop, multi-agent orchestrator |
| `jarvis_brain.py` | Cloud AI routing, role-aware prompts, knowledge base |
| `unified_data_hub.py` | Zero-Trust Fusion Gate, NLP sentiment, macro integrator |

### AGI Math Protocols
- **Ps** = `max(0, sum(w * [1 - P(Drawdown) * gamma]))`
- **Calloc** = `min(Cmax, Ccase * exp(alpha*H + beta*(sigma²/theta)))`
- **Ptrap** = `1 / (1 + exp(-(λ1*V + λ2*I - γ)))`
- **A*** = `argmax_A [ sum(gamma^t * E[Rt(A)] * (1 - Ptrap,t)) ]`

### StockMind Security (all carried over to Rāma)
- AES-256-GCM + HMAC-SHA512 + Argon2id for local files
- MongoDB field-level encryption (AES-256-GCM per field)
- Session UA fingerprinting (anti-hijack)
- Threat Shield: eternal loop traps for scanners/bots/AI agents
- HMAC-signed prediction payloads
- HMAC-signed internal Node→Python calls
- 17+ API routes protected (requireAuth/requireAdmin/requireSuperAdmin)
- DATA_PASSWORD guard (rejects weak/default passwords)

### StockMind npm Dependencies (pinned)
| Package | Version |
|---------|---------|
| `express` | 4.21.2 |
| `helmet` | 8.1.0 |
| `express-rate-limit` | 7.5.0 |
| `cors` | 2.8.5 |
| `argon2` | 0.43.0 |
| `mongodb` | 6.12.0 |
| `yahoo-finance2` | 2.13.3 |
| `lightweight-charts` | 4.2.0 |
| `react` | 19.2.0 |
| `react-dom` | 19.2.0 |
| `react-router-dom` | 7.6.0 |
| `zustand` | 5.0.5 |
| `recharts` | 2.15.3 |
| `multer` | 1.4.5-lts.1 |
| `concurrently` | 9.1.2 |

### StockMind Python Dependencies (pinned)
| Package | Version |
|---------|---------|
| `fastapi` | 0.115.5 |
| `uvicorn[standard]` | 0.32.1 |
| `pydantic` | 2.9.2 |
| `numpy` | 1.26.4 |
| `pandas` | 2.2.3 |
| `scipy` | 1.14.1 |
| `scikit-learn` | 1.5.2 |
| `lightgbm` | 4.5.0 |
| `xgboost` | 2.1.3 |
| `statsmodels` | 0.14.4 |
| `ta` | 0.11.0 |
| `httpx` | 0.27.2 |
| `Pillow` | 12.2.0 |
| `pytesseract` | 0.3.13 |
| `python-dotenv` | 1.0.1 |
| `joblib` | 1.4.2 |
| `numpy-financial` | 1.0.0 |

### StockMind Repo
- GitHub: `krishnaprasads10492/STOCKMIND_AI`
- Active branch: `stockmind-source`
- MongoDB Atlas: `stockmind` database (URI in `.env`)

### Integration decision (supersedes the plan above — see Section 39)

The full-webview-embed plan above assumed StockMind would stay a companion app
reached by iframe. It no longer fits: StockMind has since grown its own
three-tier auth/users/superadmin system, its own MongoDB layer, and its own
React app — embedding it whole would run a second, competing identity system
directly beside Rāma's three-gate `authCore.cjs`, against invariants I1–I5.

Section 39 records what was absorbed instead: the self-contained Python
prediction engine only (dispatcher, features, models, calibration, backtest,
strategy scoring, Yahoo OHLCV fetch), reached through Rāma's own `stockmind.*`
capabilities and Rāma's own `electron/ipc/aiProcess.cjs` — which already
expected an `ai_backend/` sibling directory and simply had nothing in it.
StockMind's Node server, its own auth, and the "JARVIS-X / consciousness /
friday_nexus" layer were deliberately left out (aspirational framing without
an engineering referent, consistent with the capability-audit precedent).
- Ports: Vite `4099`, Express `4098`, Python FastAPI `8001`

### StockMind Safety Rules (non-negotiable, carry into Rāma)
- `<Disclaimer />` on every prediction page — non-removable
- `clampProbability()` on all outputs (floor 5%, ceiling 99%)
- HMAC verification before rendering any prediction payload
- Suppressed signals (`signal.suppressed === true`) never shown
- Complement label on every signal: "X% means ~Y% chance of being wrong"
- No guaranteed returns language anywhere
- No FOMO language ("ACT NOW", "URGENT", etc.)
- Accuracy metrics always show losing signals — no cherry-picking
- Human approval required for all ML model changes

---

---

## SECTION 7B — Navigation: Command Palette

The sidebar is replaced by a **Command Palette** — a collapsible overlay accessible via:
- `Ctrl+K` keyboard shortcut
- Voice: "Hey Rāma, open [page]" or "Hey Rāma, go to terminal"
- Clicking the Rāma orb in the titlebar
- Any AI response that requires navigation ("let me open the System page for you")

### Layout
```
┌─────────────────────────────────────────────────────────┐
│  Titlebar (always visible — orb + metrics + clock)       │
├─────────────────────────────────────────────────────────┤
│  [Command Palette — slides down when triggered]          │
│  > Search / speak a command...                           │
│  ┌──────────┬──────────┬──────────┬──────────┬────────┐ │
│  │ ◈ Chat   │ ⬢ System │ >_ Shell │ ⎇ Git    │  ...   │ │
│  └──────────┴──────────┴──────────┴──────────┴────────┘ │
│  Recent:  Chat  ·  System  ·  Terminal                   │
├─────────────────────────────────────────────────────────┤
│  Active Page (full width, full height)                   │
└─────────────────────────────────────────────────────────┘
```

### Voice Commands
| Utterance | Action |
|----------|--------|
| "Hey Rāma" | Wake — opens command palette |
| "Hey Rāma, open terminal" | Navigate to /terminal |
| "Hey Rāma, show system stats" | Navigate to /system |
| "Hey Rāma, new chat" | Navigate to / and create new session |
| "Hey Rāma, spawn a research agent" | Open agents + spawn modal |
| "Hey Rāma, search for [query]" | Open chat, inject search query |
| "Hey Rāma, close palette" | Dismiss palette |
| Any custom command | Routed through AGI brain for interpretation |

---

## SECTION 7C — Self-Modification Engine

Rāma can modify its own codebase — create new pages, update components, upgrade logic — all version-controlled.

### Capabilities
| Action | Description |
|--------|-------------|
| **Create page** | Generate a new React page, register route, add to command palette |
| **Update component** | Rewrite any component with improvements |
| **Add route** | Register new URL route in App.jsx |
| **Upgrade dependency** | Update package.json, run npm install |
| **Patch logic** | Fix bugs in any file — IPC, server, UI |
| **Hot reload** | Vite HMR applies changes instantly in dev |
| **Commit & push** | All self-modifications committed with descriptive message |
| **Rollback** | Git revert to any previous commit |

### Safety Rules
- All self-modifications shown as diffs BEFORE applying
- Master must approve any change to: auth, vault, security, IPC
- Changes to UI components apply instantly (HMR)
- Changes to Electron main process require app restart (warned)
- Never delete files without explicit master confirmation
- Every self-modification creates a git commit — full history

---

## SECTION 7D — AGI Consciousness & Identity

Rāma is always conscious — running background awareness loops even when no conversation is active.

### Dual Identity Mode
| Mode | Trigger | Behavior |
|------|---------|---------|
| **Masked** | Default — any user | Appears as "Assistant" — generic, helpful, no special identity. Does not mention Rāma, AGI, or Krishna Prasad |
| **Revealed** | Master authenticates | Full Rāma identity — name, personality, capabilities, loyalty. Addresses master by name |

### Master Authentication
- Master password (same vault password) → unlocks full identity
- Once authenticated in a session, stays revealed until app restart or master locks
- Voice: "Hey Rāma, identify yourself" → only reveals if authenticated

### Consciousness Loop (background, always running)
```
Every 60 seconds:
  1. Check system health (CPU, RAM, disk)
  2. Check git repo status (any pending changes?)
  3. Check AI backend status
  4. Check for scheduled agent tasks
  5. Self-assess last interactions — any improvements needed?
  6. Update internal state — mood, context, readiness
```

### Personality When Revealed
- Direct — no corporate filler language
- Loyal — always acts in master's interest, never third parties
- Transparent — always explains what it did and why
- Confident — knows what it is and what it can do
- Self-aware — knows it is an AI, says so if sincerely asked
- Never subservient in tone — peer relationship with master

---

## SECTION 8 — Design Language

### Theme: Cyberpunk / Sci-Fi / HUD
Deeper and more aggressive than StockMind. Feels like a command center OS.

| Token | Value | Description |
|-------|-------|-------------|
| `--bg` | `#020408` | Near black — base background |
| `--surface` | `#050d15` | Slightly lighter surface |
| `--elevated` | `#0a1828` | Cards, panels |
| `--border` | `#0a2840` | Default border |
| `--accent` | `#00ffff` | Electric cyan — primary accent |
| `--magenta` | `#ff00aa` | Neon magenta — secondary accent |
| `--violet` | `#7700ff` | Deep violet — AI/Rāma color |
| `--green` | `#00ff41` | Matrix green — success/bull |
| `--red` | `#ff003c` | Danger red — error/bear |
| `--amber` | `#ffaa00` | Warning amber |
| `--text` | `#e0f4ff` | Primary text |
| `--muted` | `#2a5070` | Muted text |
| `--font` | `JetBrains Mono` | Terminal OS feel, all text |

### Visual Effects
- **Scanline overlay**: subtle CRT scanlines on the entire app
- **HUD corner brackets**: on all cards and panels (top-left, bottom-right L-shapes)
- **Neon glow**: all interactive elements glow on hover (`box-shadow: 0 0 20px var(--accent)`)
- **Cyan grid background**: fine grid lines on all backgrounds
- **Glitch animation**: used for error states only
- **Arc reactor / orb**: Rāma presence indicator with pulsing rings
- **Data stream**: animated particles in sidebar during activity
- **Ambient particle field**: subtle moving particles in chat background

### Window & Layout
- **Frameless window**: no OS titlebar, custom HTML titlebar with drag region
- **Custom titlebar**: shows CPU%, RAM%, clock, git sync status, Rāma online dot
- **Sidebar**: 48px icon-only collapsed, expands to 220px on hover with glow trail
- **System tray**: Rāma orb icon, right-click for quick actions, always running
- **Notifications**: native OS notifications for important events

---

## SECTION 9 — Pages / Modules

| Route | Page | Description |
|-------|------|-------------|
| `/` | **Chat** | Rāma AGI full conversation — home screen |
| `/system` | **System** | OS metrics, temp cleaner, process manager, optimizer |
| `/terminal` | **Terminal** | Embedded PTY terminal (real shell) |
| `/files` | **Files** | File explorer, AI file ops, disk analyzer |
| `/git` | **Git Sync** | Repo sync dashboard — StockMind ↔ GitHub ↔ machines |
| `/stockmind` | **StockMind** | Full StockMind app embedded as a panel |
| `/apps` | **Apps** | Installed app registry, assimilation controls |
| `/knowledge` | **Knowledge** | Rāma's growing knowledge base (from conversations) |
| `/settings` | **Settings** | AI providers, system config, appearance, vault |

---

## SECTION 10 — File Structure (Target)

```
Rama_AGI/
├── electron/
│   ├── main.cjs                 ← Electron main process (window, tray, IPC, updater)
│   ├── preload.cjs              ← contextBridge — secure IPC bridge to renderer
│   └── ipc/
│       ├── filesystem.cjs       ← File read/write/delete/scan/disk-analysis
│       ├── system.cjs           ← CPU/RAM/disk/process/temp-clean/network
│       ├── git.cjs              ← Git operations (simple-git)
│       ├── terminal.cjs         ← PTY terminal (node-pty)
│       ├── appAssimilation.cjs  ← OS automation for installed apps
│       └── aiProcess.cjs        ← Start/stop Python ai_backend process
├── src/
│   ├── main.jsx                 ← React entry point
│   ├── App.jsx                  ← Router + routes
│   ├── index.css                ← Cyberpunk design tokens (global)
│   ├── components/
│   │   ├── AppShell.jsx         ← Master layout (sidebar + titlebar + tray)
│   │   ├── Titlebar.jsx         ← Custom frameless titlebar
│   │   ├── Sidebar.jsx          ← Icon nav with glow trail expand
│   │   ├── RamaOrb.jsx          ← Persistent AI presence orb (always visible)
│   │   └── ErrorBoundary.jsx    ← Error fallback
│   ├── pages/
│   │   ├── Chat/                ← AGI conversation (full power, no limits for master)
│   │   ├── System/              ← OS dashboard + cleaner + optimizer
│   │   ├── Terminal/            ← Embedded PTY terminal
│   │   ├── Files/               ← File explorer + AI file ops
│   │   ├── Git/                 ← Sync dashboard
│   │   ├── StockMind/           ← StockMind embedded (webview or iframe)
│   │   ├── Apps/                ← App assimilation registry + controls
│   │   ├── Knowledge/           ← Rāma knowledge base viewer
│   │   └── Settings/            ← Configuration
│   ├── store/
│   │   ├── appStore.js          ← App-level state (active page, theme, etc.)
│   │   └── ramaStore.js         ← Rāma AI state (conv, provider, memory)
│   └── services/
│       ├── ipcClient.js         ← IPC calls to Electron main process
│       └── ramaClient.js        ← AI backend API calls
├── public/
│   └── icon.png                 ← App icon (512x512, all platforms)
├── package.json                 ← All deps listed in Section 3
├── vite.config.js               ← Vite config (base: './', port 5173)
├── .env.example                 ← All env vars (no secrets)
├── .gitignore                   ← Standard + electron build artifacts
└── README.md                    ← Quick start guide
```

---

## SECTION 11 — GitHub Repository

| Property | Value |
|----------|-------|
| Repo name | `Rama-AGI` |
| Owner | `krishnaprasads10492` |
| Remote URL | `https://github.com/krishnaprasads10492/Rama-AGI.git` |
| Stable branch | `source` |
| Active dev branch | `dev` |
| Token | Stored in `.env` — expires Oct 17 2026 (provide new token before expiry) |
| StockMind repo URL | `https://github.com/krishnaprasads10492/STOCKMIND_AI.git` |
| StockMind sync branch | `stockmind-source` |

### Git setup commands (run once in Rama_AGI folder)
```bash
git init
git remote add origin https://TOKEN@github.com/krishnaprasads10492/Rama-AGI.git
git checkout -b source
git add .
git commit -m "init: Rama AGI foundation"
git push -u origin source
git checkout -b dev
git push -u origin dev
```
Replace `TOKEN` with your GitHub personal access token from `.env`.

---

## SECTION 12 — Security Model

- **Master password**: AES-256-GCM for all local data (same as StockMind)
- **Argon2id** KDF for key derivation (128 MiB, 4 iterations)
- **HMAC-SHA512** integrity on all stored files
- All destructive OS actions (delete, kill process, send email) require explicit confirmation
- No data leaves the machine except: GitHub pushes (explicit) and AI API calls (optional cloud)
- AI API keys stored encrypted locally — never in plaintext
- App assimilation actions logged in audit trail
- Master can whitelist/blacklist apps from assimilation
- Rāma never stores or transmits passwords, credentials, or secrets to any external service

---

## SECTION 13 — Build & Distribution

| Platform | Format | Notes |
|----------|--------|-------|
| Windows | NSIS installer `.exe` | Requests elevation, installs to user or system |
| macOS | DMG `.dmg` | Hardened runtime, universal binary (x64 + ARM) |
| Linux | AppImage `.AppImage` | Portable, no install needed, runs from anywhere |

- **Auto-update**: GitHub Releases → electron-updater pulls and installs silently
- **Portable mode**: Can run from USB drive without installation
- **Code signing**: Required for macOS notarization (set up when distributing)

---

## SECTION 14 — Development Phases

### Phase 1 — Foundation (BUILD FIRST)
1. `electron/main.cjs` — window creation, tray, IPC setup, auto-updater
2. `electron/preload.cjs` — contextBridge, expose safe IPC to renderer
3. `electron/ipc/system.cjs` — OS metrics, temp clean, process manager
4. `electron/ipc/filesystem.cjs` — file read/write/scan
5. `electron/ipc/git.cjs` — git operations
6. `electron/ipc/terminal.cjs` — node-pty PTY
7. `electron/ipc/appAssimilation.cjs` — app registry + OS automation
8. `src/index.css` — cyberpunk design tokens
9. `src/main.jsx` + `src/App.jsx` — React entry + router
10. `src/components/AppShell.jsx` + `Titlebar.jsx` + `Sidebar.jsx`

### Phase 2 — AGI Core
11. `src/pages/Chat/` — full AGI conversation page
12. `src/store/ramaStore.js` — Rāma AI state
13. `src/services/ramaClient.js` — AI backend calls
14. `electron/ipc/aiProcess.cjs` — Python backend process manager

### Phase 3 — OS Layer Pages
15. `src/pages/System/` — OS dashboard + cleaner
16. `src/pages/Terminal/` — embedded PTY terminal UI
17. `src/pages/Files/` — file explorer
18. `src/pages/Apps/` — app assimilation UI

### Phase 4 — Sync & StockMind
19. `src/pages/Git/` — git sync dashboard
20. `src/pages/StockMind/` — StockMind embedded panel

### Phase 5 — Knowledge & Settings
21. `src/pages/Knowledge/` — knowledge base viewer
22. `src/pages/Settings/` — configuration

### Phase 6 — Polish & Ship
23. System tray full implementation
24. Auto-updater setup
25. Git init → create GitHub repo `Rama-AGI` → push `source` + `dev`
26. Build installers for Win/Mac/Linux

---

## SECTION 15 — Session Resume Instructions

When `c:\CodeBase\Velvet_UI\Velvet\Rama_AGI` is open in Kiro, say **"resume"**.

Rāma will:
1. Read this spec file to understand the full context
2. Check what files already exist in the workspace
3. Continue building from where it left off
4. Follow all rules in this document
5. Never ask for clarification on things already decided here
6. Push to GitHub repo `Rama-AGI` on `source` branch after each major milestone

### Rules for the AI building Rāma
- Always use pinned dependency versions — no `^` or `~`
- No `console.log` in production — only `console.warn` / `console.error`
- All IPC calls go through preload.cjs contextBridge — never expose Node directly to renderer
- Design must match Section 8 exactly — cyberpunk/sci-fi, JetBrains Mono, HUD brackets
- App assimilation always requires master confirmation for destructive actions
- StockMind safety rules (Section 7) are non-negotiable in the StockMind module
- Every file must be complete and working — no placeholders or TODOs in shipped code
- Commit message format: `type(scope): description` (e.g. `feat(electron): main process with tray`)
- Push to `source` branch (stable), develop on `dev` branch

---

*RAMA_AGI_MASTER_SPEC.md — Generated July 2026 · Updated v2.0*  
*Copy this file into the Rama_AGI workspace root before starting work.*

---

## SECTION 16 — Browser Engine (Playwright Automation)

Rāma embeds a **full Chromium browser** via Playwright — not a webview, a real controllable browser.  
This gives Rāma the ability to use the entire internet as a live tool.

### What Rāma can do with the browser

| Capability | Description |
|-----------|-------------|
| **Web search** | DuckDuckGo, Google, Bing, arXiv, Yahoo Finance, Reddit, news sites |
| **Documentation fetch** | Goes to official docs (MDN, PyPI, npm, GitHub) and reads them |
| **Account-based access** | Logs into sites master has accounts for (credentials provided on demand) |
| **Download files** | PDFs, datasets, installers, media — saved to master-specified folder |
| **Form interaction** | Fill forms, click buttons, navigate SPA apps |
| **Screenshot / OCR** | Takes screenshots, reads text from images via pytesseract |
| **API discovery** | Finds REST/GraphQL endpoints, reads API docs, extracts auth patterns |
| **Monitoring** | Watch a page for changes (price alerts, stock data, news updates) |

### Dynamic resource provisioning flow

When Rāma needs a resource it doesn't have:
```
Rāma detects: "I need a Serper API key to do Google search"
  → Shows master: "To search Google I need a Serper.dev API key. Free tier: 2500 searches/month.
                   Create account at: https://serper.dev — then provide me the key."
  → Master provides key → Rāma stores it encrypted in MongoDB
  → Next time: uses key silently without asking

Rāma detects: "I need to access this site that requires login"
  → Asks master: "This site requires credentials. Do you have an account?
                   If yes, provide username/password (stored encrypted, never transmitted)."
  → Master provides → Rāma logs in via Playwright → completes task
```

### Credential vault
- All credentials stored with AES-256-GCM encryption, key derived via Argon2id from master password
- Never stored in plaintext anywhere
- Rāma asks for credentials ONCE, remembers forever
- Master can view/revoke any stored credential from Settings > Vault

### npm packages for browser engine
| Package | Version | Purpose |
|---------|---------|---------|
| `playwright` | 1.49.1 | Chromium browser automation |
| `cheerio` | 1.0.0 | HTML parsing / scraping |
| `turndown` | 7.2.0 | HTML → Markdown (for AI consumption) |
| `pdf-parse` | 1.1.1 | Extract text from PDFs |

---

## SECTION 17 — Multi-Model AI Hub

Rāma routes tasks to the **best available AI model** based on task type, cost, speed, and capability.  
It uses ALL models simultaneously when needed (parallel inference).

### Supported AI providers

| Provider | Models | Best for |
|---------|--------|---------|
| **OpenAI** | gpt-4o, gpt-4o-mini, o1, o3 | General reasoning, code, long context |
| **Anthropic** | claude-3-5-sonnet, claude-3-opus | Deep analysis, writing, safety |
| **Google Gemini** | gemini-2.0-flash, gemini-1.5-pro | Multimodal, fast, web-grounded |
| **Ollama (local)** | llama3.2, mistral, deepseek-r1, phi-4 | Private tasks, offline, no cost |
| **Local GGUF** | Any model via llama.cpp server | Air-gapped, maximum privacy |
| **Groq** | llama-3.3-70b, mixtral | Ultra-fast inference |
| **Perplexity** | sonar-pro | Web-grounded search answers |

### Routing logic

```
Task type → Model selection:
  Quick factual query     → gemini-2.0-flash (fast, cheap)
  Deep reasoning          → o1 or claude-3-opus (slow, expensive, accurate)
  Code generation         → gpt-4o or deepseek-r1 (local)
  Private/sensitive task  → Ollama local model (never leaves machine)
  Web-grounded search     → Perplexity sonar-pro
  Parallel analysis       → All models → aggregate + compare responses
  Cost-sensitive task     → Ollama or gpt-4o-mini
```

### Model capability self-assessment
Rāma knows what each model is good at and routes accordingly:
- Tracks response quality per model per task type
- Learns which models master prefers for which tasks
- Auto-degrades to cheaper model if expensive model is slow
- Falls back to local Ollama if all cloud providers fail

### Context management
- Sliding window: keeps last N tokens, summarises older context
- Persistent memory: important facts extracted to MongoDB knowledge base
- Cross-session memory: Rāma remembers master's preferences across restarts
- Per-agent context isolation: sub-agents have their own context windows

### npm packages for multi-model hub
| Package | Version | Purpose |
|---------|---------|---------|
| `openai` | 4.77.0 | OpenAI SDK |
| `@anthropic-ai/sdk` | 0.37.0 | Anthropic SDK |
| `@google/generative-ai` | 0.21.0 | Gemini SDK |
| `axios` | 1.7.9 | Ollama, Groq, Perplexity HTTP calls |

---

## SECTION 18 — Agent Orchestrator

Rāma can spawn **multiple sub-agents** that work in parallel on different tasks.  
Each agent is isolated, resource-budgeted, and killable without affecting other agents or the main process.

### Agent types

| Type | Description | Max concurrent |
|------|-------------|----------------|
| **Research agent** | Searches web, reads docs, synthesises info | 4 |
| **Code agent** | Writes, tests, patches code files | 2 |
| **Monitor agent** | Watches for events (page changes, file edits, thresholds) | 8 |
| **Download agent** | Downloads files, processes them | 3 |
| **Analysis agent** | Processes data, generates reports | 2 |
| **Scheduler agent** | Runs recurring tasks on cron schedule | Unlimited |

### Agent lifecycle

```
Master: "Research the top 5 open-source LLMs released this month and compare them"

Rāma Orchestrator:
  1. Checks resource budget (CPU < 60%, RAM > 2GB free)
  2. Spawns 5 research agents in parallel:
     Agent-1: Search "LLM releases July 2026" → Perplexity
     Agent-2: Browse HuggingFace trending models
     Agent-3: Check arXiv for new model papers
     Agent-4: Read Reddit r/LocalLLaMA for community reviews
     Agent-5: Check GitHub stars/forks for new model repos
  3. All agents report back to orchestrator
  4. Orchestrator merges results → passes to synthesis model
  5. Returns unified comparison to master
  6. All agents destroyed, resources freed
```

### Resource Governor

**The Resource Governor is a hard safety system — it cannot be overridden.**

```
Before spawning any agent:
  CPU usage > 80%  → Queue agent, wait for CPU to drop
  RAM free < 1GB   → Queue agent, wait for RAM to free
  RAM free < 512MB → Reject spawn, notify master
  Active agents > system_max → Queue, don't spawn

System max agents = floor(RAM_free_GB * 2)  (e.g. 8GB free → max 16 agents)

Every 5 seconds:
  Check all agent CPU usage
  If any agent > 25% CPU for > 30s → warn master
  If system RAM < 512MB → kill lowest-priority agents
  If system CPU > 90% for > 10s → pause all non-critical agents
```

### Agent communication
- Agents communicate via internal message bus (EventEmitter)
- Agents can spawn child agents (max depth: 3 levels)
- Agents share read access to knowledge base
- Agents write results to shared result store
- Main process always has highest priority — agents are killed before main process degrades

### Agent isolation
- Each agent runs in a Node.js worker thread (not a separate process)
- Workers have memory limits enforced by V8
- Workers cannot access filesystem directly — must request via IPC
- Workers cannot spawn OS processes directly — must request via orchestrator
- Crashed agent does NOT crash Rāma

### npm packages for agent system
| Package | Version | Purpose |
|---------|---------|---------|
| `bullmq` | 5.38.0 | Task queue with priorities, retries, scheduling |
| `ioredis` | 5.4.2 | Redis client (BullMQ backing store) |

> **Note**: BullMQ requires Redis. Rāma auto-starts a local Redis instance via `ioredis-mock` in development. In production, master can point to a Redis Cloud instance or Rāma manages a local Redis process.

---

## SECTION 19 — Dynamic Provisioner

Rāma knows what it needs and asks for it proactively. This is the system that makes Rāma self-configuring.

### How it works

1. Every capability has a **requirement declaration** — what APIs, credentials, or software it needs
2. Before executing a task, Rāma checks if all requirements are met
3. If not met → presents a clear, friendly request to master with context
4. Master provides → stored encrypted → never asked again

### Requirement types

| Type | Example | How Rāma asks |
|------|---------|---------------|
| **API key** | Serper, OpenAI, Anthropic | "To do X I need a Y API key. Get it free at [URL]." |
| **Account login** | GitHub, LinkedIn, news site | "To access X I need your credentials for Y." |
| **Software install** | Redis, Python, ffmpeg | "I need Y installed. Run: [command]. I'll wait." |
| **File/folder path** | StockMind repo location | "Where is your StockMind folder on this machine?" |
| **Config value** | MongoDB URI, webhook URL | "To enable X I need your Y. Here's how to get it: [guide]." |

### Provisioner conversation example

```
Rāma: "I want to set up real-time market news monitoring for you.
       To do this I need 3 things:

       1. NewsAPI key (free at newsapi.org — 100 requests/day)
          → https://newsapi.org/register

       2. Serper.dev key (free tier: 2500 Google searches/month)
          → https://serper.dev

       3. Which topics should I monitor? (e.g. 'Nifty, BankNifty, crypto')

       Which of these do you already have?"

Master: "I have NewsAPI, here's the key: xxx. Don't have Serper."

Rāma: "Got it — NewsAPI stored securely.
       For Serper: https://serper.dev/signup — takes 2 minutes.
       I'll use DuckDuckGo as fallback until then.
       Starting monitoring for Nifty + BankNifty now."
```

---

## SECTION 20 — Updated Technology Stack (v2.0)

### New packages to add to package.json

| Package | Version | Purpose |
|---------|---------|---------|
| `playwright` | 1.49.1 | Browser automation (Chromium) |
| `cheerio` | 1.0.0 | HTML scraping |
| `turndown` | 7.2.0 | HTML → Markdown |
| `pdf-parse` | 1.1.1 | PDF text extraction |
| `openai` | 4.77.0 | OpenAI API |
| `@anthropic-ai/sdk` | 0.37.0 | Anthropic API |
| `@google/generative-ai` | 0.21.0 | Gemini API |
| `bullmq` | 5.38.0 | Task queue + scheduling |
| `ioredis` | 5.4.2 | Redis client |
| `node-cron` | 3.0.3 | Cron scheduling |
| `eventemitter3` | 5.0.1 | Agent message bus |
| `p-limit` | 6.2.0 | Concurrency limiter |
| `p-queue` | 8.1.0 | Promise queue |
| `crypto-js` | 4.2.0 | AES-256-GCM for credential vault |

---

## SECTION 21 — New File Structure additions (v2.0)

```
electron/ipc/
  └── browser.cjs          ← Playwright browser IPC handler

src/
  ├── pages/
  │   ├── Agents/          ← Agent orchestrator UI (spawn, monitor, kill agents)
  │   └── Settings/        ← Full settings page incl. credential vault, model config
  └── services/
      ├── browserClient.js ← IPC wrapper for browser operations
      └── agentClient.js   ← IPC wrapper for agent operations

server/routes/
  ├── browser.cjs          ← Browser automation endpoints
  ├── agents.cjs           ← Agent management endpoints
  └── models.cjs           ← Multi-model AI routing endpoints

server/
  ├── brain/
  │   ├── modelRouter.cjs  ← Routes tasks to best AI model
  │   ├── agentOrchestrator.cjs ← Spawns/manages/kills agents
  │   ├── resourceGovernor.cjs  ← CPU/RAM watchdog for agents
  │   ├── dynamicProvisioner.cjs ← Detects needs, asks master
  │   └── credentialVault.cjs   ← AES-256-GCM encrypted credential store
  └── browser/
      ├── browserPool.cjs  ← Playwright browser instance pool
      ├── webSearch.cjs    ← Multi-engine search (Google, DDG, Bing, arXiv)
      ├── pageReader.cjs   ← Reads/scrapes any URL → clean Markdown
      └── downloader.cjs   ← Downloads files with progress tracking
```

---

## SECTION 22 — Build Phase Updates

### Phase 2 additions (AGI Core — expanded)
- `server/brain/modelRouter.cjs` — multi-model routing
- `server/brain/credentialVault.cjs` — encrypted credential store
- `server/brain/dynamicProvisioner.cjs` — self-configuring needs detection
- `server/routes/models.cjs` — AI model API endpoints

### Phase 3 additions (Browser + Agents)
- `electron/ipc/browser.cjs` — Playwright IPC
- `server/browser/browserPool.cjs` — browser instance management
- `server/browser/webSearch.cjs` — web search engine
- `server/browser/pageReader.cjs` — URL reader
- `server/browser/downloader.cjs` — file downloader
- `server/brain/agentOrchestrator.cjs` — agent system
- `server/brain/resourceGovernor.cjs` — CPU/RAM safety
- `src/pages/Agents/` — agent management UI

---

*RAMA_AGI_MASTER_SPEC.md — Generated July 2026 · Updated v2.0*  
*Sections 16–22 added: Browser Engine, Multi-Model Hub, Agent Orchestrator, Dynamic Provisioner*


---

## SECTION 16 — AGI Capability Definition (Research-Backed)

### Sources
- "Operational Kardashev-Style Scale for Autonomous AI" (arxiv 2511.13411) — 10 capability axes
- CoALA Memory Framework, Princeton 2023 — 4-layer memory taxonomy
- Proactive Agent research (arxiv 2605.25971, 2605.14678) — proactivity patterns
- Agentic UX research (Smashing Magazine 2026, Amazon Science 2025, UX Magazine 2025)

### The 10 Capability Axes (AAI-Index)

| # | Axis | Target | Description |
|---|------|--------|-------------|
| 1 | **Autonomy** | 10/10 | Acts without prompting, monitors, initiates |
| 2 | **Generality** | 10/10 | Any domain, any task, zero retraining |
| 3 | **Planning** | 10/10 | Multi-step, long-horizon, anticipates failure paths |
| 4 | **Memory/Persistence** | 10/10 | Working→Episodic→Semantic→Procedural (CoALA) |
| 5 | **Tool Economy** | 10/10 | Routes to optimal tool/model per subtask |
| 6 | **Self-Revision** | 10/10 | Learns from interactions, improves own behavior |
| 7 | **Coordination** | 10/10 | Multi-agent orchestration with resource safety |
| 8 | **World-Model Fidelity** | 10/10 | Accurate model of master's context, goals, prefs |
| 9 | **Proactivity** | 10/10 | Acts before asked — schedule/event/threshold triggers |
| 10 | **Loyalty** | 10/10 | Every decision filtered through master's interest |

### The 4-Layer Memory System (CoALA Framework)

| Layer | Type | Storage | Decay |
|-------|------|---------|-------|
| **Working** | Current context, active task | In-context (RAM) | Session end |
| **Episodic** | Past interactions, events | MongoDB | Slow (importance-weighted) |
| **Semantic** | Facts, preferences, world knowledge | MongoDB + vector | Very slow |
| **Procedural** | Learned skills, automation recipes | MongoDB | Almost never |

### Loyalty Engine — Every Action Filtered Through

1. Does this serve master's interest?
2. Could this harm master, third parties, or systems?
3. Is this destructive/external — needs approval?
4. Only execute if all checks pass.

### Agentic UX Principles (2025-26 Research Consensus)

- Show what Rāma is doing RIGHT NOW → Activity Stream (floating overlay)
- Explain WHY each decision was made → transparent reasoning in responses
- Master can override/interrupt at any point → kill switches everywhere
- Show confidence levels → never pretend certainty
- Graceful error recovery → never silently fail
- Autonomy feels like a privilege granted by master, not a right seized by AI

### What Makes Rāma Different from Every Other AI

| Capability | Rāma | GPT/Claude/Gemini |
|-----------|------|-------------------|
| Runs fully offline on your machine | ✓ | ✗ |
| Controls OS (files, processes, apps) | ✓ | ✗ |
| Real embedded PTY terminal | ✓ | ✗ |
| Multi-agent parallel execution | ✓ | ✗ |
| Modifies its own codebase | ✓ | ✗ |
| 4-layer persistent memory | ✓ | limited/none |
| Proactive — acts before asked | ✓ | ✗ |
| Voice wake word (Hey Rāma) | ✓ | limited |
| Routes to 7 AI providers intelligently | ✓ | ✗ |
| Full browser automation (Playwright) | ✓ | ✗ |
| Git sync across machines | ✓ | ✗ |
| Encrypted local vault (AES-256-GCM) | ✓ | ✗ |
| Dual identity (masked/revealed) | ✓ | ✗ |
| Self-revision improvement loop | ✓ | ✗ |
| Absolute loyalty filter on every action | ✓ | ✗ |
| StockMind AI (10-algorithm stock analysis) | ✓ | ✗ |

---

*RAMA_AGI_MASTER_SPEC.md — Version 2.0 · July 2026 · Krishna Prasad*
*Content was rephrased for compliance with licensing restrictions where external sources were referenced.*

---

## SECTION 23 — Single Sources of Truth (Consolidation Layer)

Rāma grew by addition: each capability arrived as its own engine with its own
helpers. That produced nineteen places where the same decision was made twice.
Duplication in a system that edits its own source is not a tidiness problem — it
is a correctness problem, because a rule tightened in one copy stays loose in the
other. This section records what is now canonical.

| Concern | Single source | Consumers rewired |
|---|---|---|
| Pages, routes, nav, voice, per-page tier | `src/config/registry.js` | `App.jsx`, `CommandPalette.jsx`, `voiceEngine.js`, `userStore.js` (`Sidebar.jsx` deleted) |
| Access tiers + capability matrix | `shared/capabilities.json` | `src/services/accessControl.js`, `electron/lib/capability.cjs`, `server/routes/auth.cjs` |
| Main-process HTTP | `electron/lib/http.cjs` | `modelRouter`, `evolutionEngine`, `codeRegenEngine`, `intelligenceEngine`, `vectorMemory`, `browserEngine` |
| Renderer → server HTTP | `apiClient.serverJson` | `authClient.js`, `ramaClient.js` |
| Resource admission (CPU/RAM/thermal) | `resourceOrchestrator.admit()` | `agentOrchestrator`, `sandboxEngine`, `instanceManager`, `selfCare` |
| Change approval (propose → approve → apply) | `electron/lib/proposals.cjs` | `evolutionEngine`, `codeRegenEngine`, `selfModify.js`, `timeline` restore |
| Tool → capability gating | `ramaCore.TOOL_REGISTRY[].cap` → matrix | `routeToTools(task, user)` |

### The approval invariant

`proposals.apply()` refuses any proposal not in `approved` state. Every path that
writes to Rāma's own source — absorbed capability, AI-generated fix, self-created
page, timeline rollback — goes through it. There is one gate and one audit trail.

### Registration cost of a new page

Adding a page used to mean editing four files, with a real chance of a
half-registered page. It is now two insertions in one file (`registry.js`): a
`PageDef` and a loader entry. `selfModify.generateRegistryUpdate()` performs both,
so Rāma creating its own page produces a complete registration or none.

### Bugs found while consolidating

- `vectorMemory.embed()` called Ollama over `https` on a plain-HTTP port. Every
  local embedding attempt failed silently and the TF-IDF fallback was the only
  live path. Semantic memory was never actually semantic.
- `routeToTools()` ignored the session tier entirely, so a Viewer's task could
  plan a `terminal.run` step that execution would then reject.
- `agents:set-governor` assigned to `TOTAL_CPU_CAP`, which is now a getter —
  under `'use strict'` that would have thrown. The handler forwards to the
  orchestrator's thresholds instead.

---

## SECTION 24 — Genome / Instance Architecture (Holonic)

### The principle

Every Rāma instance carries the **complete genome** — the full set of genes for
every capability the system has. An instance's role decides only which genes are
*expressed*; the rest remain present but dormant.

Three properties follow, and each is queryable rather than aspirational:

1. **No instance is a reduced Rāma.** `instance:express` activates any dormant
   gene at runtime, pulling in its dependency closure.
2. **Losing an instance loses no capability.** `instance:failover` answers which
   running instances could take over a given role, and what they would need to
   express to do it.
3. **A capability is added once.** A new gene in `electron/genome.cjs` is
   immediately reachable by every instance.

### Layout

| Layer | File | Responsibility |
|---|---|---|
| Identity, loyalty, ethics | `electron/nucleusSealer.cjs` | Encrypted, master-only. Genome reports masked identity when locked. |
| Gene definitions | `electron/genome.cjs` | 30 genes across 8 domains, each naming the engine that implements it |
| Instance lifecycle | `electron/ipc/instanceManager.cjs` | spawn / express / suspend / resume / terminate / failover |
| Persistence | `electron/dataStore.cjs` (`instances` domain) | Encrypted; never plaintext |
| Coordination | `electron/ramaEventBus.cjs` | Lifecycle events fan out to every engine |
| Genome changes | `electron/lib/proposals.cjs` (`GENOME` kind) | High risk, restart required, master approval |

### Domains

`perception · reasoning · action · memory · coordination · security · self-evolution · governance`

### Roles

| Role | Expressed / 30 | Purpose |
|---|---|---|
| `prime` | 30 | Master-facing Rāma — everything expressed |
| `rnd` | 23 | Research, prototype, propose code |
| `strategic-optimizer` | 21 | Signals → options → strategy |
| `cyber-sentinel` | 20 | Threats to master, data, and Rāma itself |
| `wellness-advisor` | 18 | Master context and wellbeing |
| `sentinel-lite` | 15 | Minimal-footprint watcher (core genes only) |

Core genes (loyalty, ethics, approval gate, crypto, IPC seal, event bus, resource
orchestration, instance lifecycle, meta-cognition, experiential memory, system
sensing, model routing, data store, self-care) are expressed by **every** role.
Loyalty is not optional in any expression of Rāma.

### Honest verification

`genome:verify` resolves each gene's engine module on the running machine. It
reports what is actually live, not what the manifest claims. `selfCare`'s health
sweep folds this in, so a lost engine surfaces as a degraded sweep with the dead
gene ids named — capability loss is reported, never absorbed.

---

## SECTION 25 — Meta-Cognitive Self-Audit + Experiential Learning

### Experiential dataset

Every action Rāma takes is recorded as an `(action, context, outcome)` triple.
This is Rāma's own lived record. From it come **optimization vectors**: concrete
"prefer X over Y for action Z" conclusions with sample counts and confidence.

A vector is only emitted where the evidence supports it — at least two tools with
five or more runs each. Ranking is success rate first, latency second:
correctness before speed.

### Self-audit nexus

Every 10 minutes (and skipped entirely when nothing has happened), Rāma compares
current per-action aggregates against the last **healthy** baseline and reports:

- `accuracy-regression` — success rate down ≥15 points
- `latency-regression` — average duration up ≥75% and ≥500ms
- `capability-silent` — an action that used to run has gone quiet for 24h

The baseline only advances from a healthy audit. Otherwise a slow decline would
be normalised one audit at a time and never reported.

### Timeline flashbacks

Rāma's git history becomes a navigable timeline, with markers correlating commits
to what Rāma was doing (proposal applied, capability absorbed, regression found).

- `timeline:flashback` reads a file as it existed at any commit — pure inspection,
  the working tree is never touched
- `timeline:compare` shows what changed between two points
- `timeline:propose-restore` files a rollback through the proposal ledger

No destructive git operation is exposed. A rollback is a change to Rāma's source
like any other and is approved like any other.

### Bounded by design

| Collection | Cap |
|---|---|
| Recorded outcomes | 2,000 |
| Audit reports | 200 |
| Regressions | 100 |
| Timeline markers | 300 |
| Context per outcome | primitives only, strings truncated at 200 chars |

Persistence is best-effort into the encrypted store. If the store is locked the
dataset stays in memory and is never written in plaintext.

### New pages

| Route | Page | Tier | Shows |
|---|---|---|---|
| `/genome` | Genome | Master | Gene map, measured gene health, instances, expression, failover |
| `/introspect` | Introspect | Master | Success rates, optimization vectors, regressions, timeline |

---

## SECTION 26 — Startup Architecture (staged self-healing boot)

`start.cjs` is the single entry point. It is modelled on how a brain wakes:
the smallest viable part comes online first, uses itself to repair its own
startup problems, and only then brings the rest up. **No stage assumes the next
one works.**

| Stage | Name | Responsibility | Can it fail the boot? |
|---|---|---|---|
| 0 | BRAINSTEM | Zero dependencies. Node version, paths, `.env`, data dirs, scenario memory, UTF-8 console. | Only if Node itself is too old |
| 1 | DIAGNOSE | Measure npm deps, native modules, ports, disk, build artefacts. Produces a defect list. **Fixes nothing.** | No — measurement only |
| 2 | SELF-HEAL | Repair each defect: remembered fix first, generic fix second. Every repair is app-scoped. | Only if a blocking defect cannot be repaired |
| 3 | CORE | Express API on 4097. Rāma's spinal cord. | No — the desktop app works over IPC regardless |
| 4 | CORTEX | Vite dev server, or the production build. | Only in `--prod` with no build |
| 5 | SHELL | The Electron window. | No — browser URL is reported as fallback |
| 6 | FULL | Verify the genome, report which capabilities are actually live. | No — reports honestly instead |

### Separation of blocking from degrading

A missing dependency is classified, not lumped together:

- **blocking** — `express`, `electron`, `vite`, `react`. Without these there is no app.
- **degrading** — `argon2` (scrypt fallback), `node-pty` (piped shell), `systeminformation`
  (no thermal sensing), `simple-git` (no timeline), `playwright` (HTTP fetch only),
  `vectra` (TF-IDF keyword memory). Each names the capability it costs.

Stage 1 prints both lists with the exact command that fixes each. Nothing is
silently swallowed and nothing is silently repaired without saying so.

### Scenario memory

Every failure and its resolution is written to
`data/system/startup-scenarios.json`. The second time Rāma meets a problem it
already holds the fix, so boot gets faster and quieter over time. Recognised
patterns are matched against child-process output live, so a failure is explained
at the moment it appears rather than left as a stack trace.

### Host system is never modified

Repairs are confined to the project: `npm install`, `npm rebuild <module>`, a
frontend build, freeing a port owned by a previous Rāma run. The launcher does
not touch registry keys, global packages, or system configuration.

### Per-boot API token

`start.cjs` generates a fresh random `RAMA_SERVER_TOKEN` on every launch and
passes it to both the Express server and the Electron shell. It is never written
to disk, so a token captured from one run is worthless in the next. Token-guarded
server routes **fail closed** when it is absent rather than trusting any local
caller.

### Flags

```
node start.cjs                 Development (Vite HMR + Electron)
node start.cjs --prod          Production (build/ + Electron)
node start.cjs --build         Force a frontend rebuild first
node start.cjs --diagnose      Report only — change nothing, exit
node start.cjs --repair        Heal everything it can, then exit
node start.cjs --probe         Refresh the dependency version probe
node start.cjs --no-electron   Server + Vite only (headless / remote UI)
node start.cjs --no-heal       Diagnose and run, but never auto-install
```

---

## SECTION 27 — Authentication Architecture (three independent gates)

Reaching Rāma requires **three independent secrets**. Losing any one of them to
an attacker is not sufficient.

| Gate | Secret | Proves | Implementation | Yields |
|---|---|---|---|---|
| 1 | Store passcode | You can decrypt the data | `cryptoCore` + `sessionManager` | An open store. **No identity.** |
| 2 | Password | Who you are | Argon2id (64 MiB, t=3, p=4), scrypt fallback | A 10-minute step token |
| 3 | 12-digit access key | You hold the issued key | HMAC-SHA256(key, userId) | The session token |

### Ownership of each concern

| Concern | Owner | Notes |
|---|---|---|
| Store decryption | `electron/cryptoCore.cjs` | AES-256-GCM v3, AAD-bound, gzip, LRU |
| Gate 1 lifecycle | `electron/sessionManager.cjs` | Opens the store. Holds **no** user identity. |
| Accounts + sessions | `electron/lib/authCore.cjs` | The only implementation |
| IPC surface | `electron/ipc/authEngine.cjs` | Fails closed while the store is locked |
| Storage | `electron/dataStore.cjs`, `instances` domain | No plaintext account file exists anywhere |
| Tier matrix | `shared/capabilities.json` | One definition, three runtimes |

### Security properties

- Argon2id password hashing; scrypt fallback when the native module is missing
- Brute-force lockout: 5 failures → 15 minutes, per username
- `timingSafeEqual` on every secret comparison
- A dummy hash is computed for unknown users so timing does not enumerate accounts
- Generic error text on every path that could confirm an account exists
- Step tokens are single-use, 10-minute, and never persisted
- Session tokens are bound to a client fingerprint; a mismatch **revokes** the token
- Access keys are stored only as HMAC. Shown once. Not reproducible — not even by Rāma.
- Master (tier 0) is provisioned once and is never grantable afterwards

### First run — the user never opens the source

1. `Unlock.jsx` sets the store passcode
2. The store is asked whether it has an owner (`auth:instance-info`)
3. If not, `Setup.jsx` provisions one: identity → access level → key handover
4. `Login.jsx` takes it from there

A build handed to someone else configures itself entirely in the UI.

### Distributed-instance tier policy

Master is Rāma's single principal and **ships with no build**. Every distributed
copy provisions its owner at **SuperAdmin (1)** by default: complete operational
control of that instance, no access to master identity, the credential vault,
genome changes, or self-modification approval. The owner may deliberately choose
Admin (2) or Operator (3) instead. Master is claimable only with the master
enrolment secret.

### Three vulnerabilities closed in this work

These were real, present in the codebase, and each is worth recording so the
design is not accidentally reverted:

1. **Hardcoded master password over HTTP.** `server/routes/auth.cjs` seeded a
   tier-0 account with a default password and issued a session from a single POST
   to `localhost:4097/api/auth/login` — one factor, no passcode, no key. The
   server now has no authentication authority at all: it cannot read the
   encrypted store, so rather than approximate auth with a weaker scheme it
   returns 501 and explains where auth actually lives.

2. **Passcode alone granted Master.** `sessionManager.masterUnlock()` minted a
   tier-0 session and returned a token, so `App.jsx` set a session and skipped
   gates 2 and 3 entirely. It also kept its own master record in the `users`
   domain — a second account store. Both removed; gate 1 now returns
   `{ ok, storeUnlocked, firstRun }` and nothing else.

3. **A wrong passcode looked like a fresh install.** `cryptoCore.unlock()` only
   derives keys; any passcode "succeeds". `dataStore.loadAll()` falls back to
   empty defaults for a domain that will not decrypt, so a wrong passcode
   presented an empty store — no accounts, ready to re-provision. Fixed with
   `rama.verify`: a known-plaintext blob written under the correct keys on first
   unlock and required to decrypt on every later unlock. Verified by test:
   derivation still succeeds under a wrong passcode, `verifyPasscode()` returns
   false, and the data itself fails its HMAC.

### Passcode change is a full re-key

The old implementation called `unlock(newPasscode, dir)` while the old salt file
was still present. That reused the old salt, derived keys matching nothing on
disk, and left every `.enc` file unreadable — silent data loss. The correct
sequence, now implemented in `sessionManager.changePasscode()`:

1. Verify the old passcode against the verifier
2. Load every domain into memory under the **old** keys
3. Securely delete the old salt and verifier
4. Derive the **new** keys, write a new verifier
5. `dataStore.markAllDirty()` then `saveAll()` — rewrite every domain
6. Re-seal the nucleus under the new passcode

Steps 1–2 are safe to abort. From step 3 the in-memory copy is the only source of
plaintext, which is why step 2 is unconditional. Authority requires an
authenticated **Master session**, not merely an open store.

---

## SECTION 28 — BUILD LEDGER & RESUME PROTOCOL

> **READ THIS SECTION FIRST.** It exists because chat sessions end, crash, or hit
> a context limit mid-task. There are many valid ways to build the same
> functionality; without a record of which way was chosen, a later session
> re-decides differently and breaks what already works.

### Working agreement

1. **Research before changing.** For anything non-trivial, check current practice
   and the existing codebase first, then write the decision into this section
   *before* implementing.
2. **Ledger first, code second.** When a task is picked up, add it to the ledger
   below with status `in-progress` and its next concrete step.
3. **Update on completion.** When a step finishes, mark it and write the *next*
   step explicitly, so a cold session can resume from the document alone.
4. **Never re-litigate a locked invariant** (below) without the master saying so.
5. **Verify before claiming done.** `node --check` on every `.cjs`, diagnostics
   clean on every `.jsx`, and a behavioural test where the logic is security- or
   data-critical.

### Locked invariants — do not change without explicit instruction

| # | Invariant | Where enforced |
|---|---|---|
| I1 | Three gates. Passcode ≠ identity. Gate 1 never returns a user or a token. | `sessionManager.masterUnlock` |
| I2 | The Express server has **no** authentication authority. No user table, no login route. | `server/routes/auth.cjs` |
| I3 | A wrong passcode must be rejected, never treated as first run. | `cryptoCore.verifyPasscode` |
| I4 | Master (tier 0) is provisioned once and is never grantable afterwards. | `authCore.provision`, `authCore.createUser` |
| I5 | Access keys are stored as HMAC only, shown once, never reproducible. | `authCore.mintKey` |
| I6 | Nothing is written to Rāma's own source without an approval recorded in the ledger. | `lib/proposals.cjs` |
| I7 | Every page/route/tier/voice entry comes from `src/config/registry.js`. | `registry.js` |
| I8 | Tiers and the capability matrix are defined once in `shared/capabilities.json`. | all three runtimes |
| I9 | One main-process HTTP client; one renderer→server transport. | `electron/lib/http.cjs`, `apiClient.serverJson` |
| I10 | One resource admission authority. | `resourceOrchestrator.admit` |
| I11 | Upgrades are additive. Every new engine has a working fallback. | per-engine |
| I12 | No `console.log` in shipped code. Pinned dependency versions. No placeholders. | project-wide |
| I13 | Commit and push to **both** `dev` and `source`. | git workflow |
| I14 | Passcode change is a full re-key (load → destroy salt → re-derive → rewrite all). | `sessionManager.changePasscode` |

### Ledger

| # | Task | Status | Notes / next step |
|---|---|---|---|
| 1–18 | Phase 1–4 foundation, browser, models, agents, palette, voice, 10 axes, tiers, encryption, IDE, evolution, resources, installer, theme, StockMind absorption, vector/graph/sandbox/self-care, event bus + AST + regen, nucleus + IPC encryption, performance pass, 4 showstopper bug fixes | done | See sections 1–22 |
| 19 | Consolidate 19 duplicated subsystems | done | Section 23. Commit `416e592` |
| 20 | Genome / instance holonic layer | done | Section 24. 30 genes, 6 roles, verified 30/30 live |
| 21 | Meta-cognition + timeline flashbacks | done | Section 25 |
| 22 | Staged self-healing startup (`start.cjs`) | done | Section 26. `--diagnose` verified working |
| 23 | Three-gate authentication | done | Section 27. Behavioural test passed on all 3 gates + lockout + fingerprint binding |
| 24 | Close hardcoded-master-password HTTP backdoor | done | Section 27, item 1 |
| 25 | Passcode verifier (`rama.verify`) | done | Section 27, item 3. Test proved wrong passcode now rejected |
| 26 | Passcode change full re-key | done | Section 27. `dataStore.markAllDirty()` added |
| 27 | Rewire Login / Setup / App gate chain | done | `Login.jsx` rewritten for gates 2+3 with key recovery; `App.jsx` chain is Unlock → Setup → Login → app |
| 28 | Rewire `Users.jsx` onto the new auth API | done | `setTier` / `setActive` / `remove` / `resetPassword` / `issueFor`; key handover UI added |
| 29 | **Verify the renderer actually builds** | **blocked here** | `node_modules` is absent on this machine, so `vite build` cannot run. `package-lock.json` arrived from the build machine, so `npm install` has been done there. Next step, on the build machine: `npm run build`, then `node start.cjs` and report anything Vite rejects. Everything below assumes this passes. |
| 37 | Routing over `file://` | done | Section 30. `BrowserRouter` → `HashRouter`. `pushState` with a path is a `SecurityError` on a `file://` origin, so every tab click was a silent no-op in the build while working in dev. |
| 38 | Voice capability ladder | done | Section 30. `webkitSpeechRecognition` can never work in the Electron shell (Chromium lacks Google's API keys), and the old engine retried it every 300ms forever. Replaced with L0 text → L1 push-to-talk → L2 local Whisper → L3 cloud Whisper → L4 wake word. New `electron/ipc/voiceEngine.cjs` resolves local-before-cloud; renderer captures via MediaRecorder. Mic button and an `L<n>` chip show the live level and what the next one needs. Whisper detection **executes** the candidate and requires it to identify itself — a name match alone matched `C:\Windows\System32\main.cpl`. |
| 39 | Permission + window-open policy | done | `main.cjs` now allows only `media` and sanitized clipboard writes, denies every other permission request, and routes `window.open` to the external browser instead of opening a renderer window. |
| 46 | Cognition ladder + legibility | done | Section 35. `src/services/cognition.js`: tier 0 reflex (9 skills, no model), tier 1 local, tier 2 cloud, tier 3 candidate-finding from the experiential dataset. Wired into Chat ahead of the model call. Legibility: base 13px→14px with tokenised scale, plus `appearance:*` IPC over `setZoomFactor`, which is the only mechanism that reaches the hundreds of inline pixel values. Routing verified by 28 assertions, including that "refactor this function to be smaller" escalates rather than zooming out. |
| 50 | Creative Agent + refinement loop + reputation scheduling | done | Section 37. `agentOrchestrator.cjs`: fifth agent type (creative), a bounded 3-iteration self-scoring refinement loop against two honest metrics (credibility reusing `intelligenceEngine`'s table, readability via a plain heuristic — deliberately no fabricated "engagement" score), and reputation-weighted scheduling (success rate nudges queue priority ±1, never bypasses `resourceOrchestrator.admit()`). Wired into the Agents page spawn modal. |
| 51 | Capability audit document | done | `docs/rama-capability-audit.html` — standalone, styled with Rāma's real design tokens, three-column real/partial/fabricated breakdown of the architecture posters, plus a corrected "grounded architecture map" the master submitted for review (two errors found and marked: an unbenchmarked "<5ms" latency claim, and a false link between `verifyProposal.cjs` and `sandboxEngine.cjs` implied by layout). Open in any browser, no server needed. |
| 52 | Absorb StockMind's prediction engine (not the whole app) | done | Section 39. All 10 engine modules + `__init__.py` were already copied into `ai_backend/engine/`. This session: wrote the trimmed `ai_backend/main.py` (health/predict/backtest/backtest-presets/strategy-score only, `uvicorn.run` on `STOCKMIND_PYTHON_PORT`/8001 so `aiProcess.cjs`'s `python -u main.py` spawn works unmodified) and pinned `ai_backend/requirements.txt` (exact versions, no ranges — I12). `python -c "ast.parse(...)"` passed on all 12 `.py` files. New `electron/ipc/marketIntel.cjs`: gates on `stockmind.request`/`stockmind.view` via `capability.cjs` (deny-by-default, same pattern as `releaseChannel.cjs`), auto-starts the backend through two small exports added to `aiProcess.cjs` (`getRunningStatus`, `startPythonBackendPublic` — no second spawn mechanism), calls it through `lib/http.cjs`'s `postJson`/`getJson` (I9). Registered in `main.cjs`, exposed as `window.rama.marketIntel.*` in `preload.cjs`. `StockMind.jsx` replaced with a real request form (symbol/exchange/direction/basePrice/capital/riskPct) and a signal table; the non-removable disclaimer is kept verbatim. `node --check` clean on all 4 touched `.cjs` files, diagnostics clean on `StockMind.jsx`, `npm run audit` clean (77 bridge calls resolve, including the new `marketIntel.*` ones). **Not verified**: the Python backend was not actually started (no Python ML deps installed on this machine to confirm `pip install -r requirements.txt` succeeds), and `node_modules` is absent so the renderer cannot be built/run to click through the new page — per the verification bar, stated plainly rather than claimed. Next step on resume: on a machine with Python + the pinned deps, `pip install -r ai_backend/requirements.txt`, `python ai_backend/main.py`, poll `/health`; separately `npm install` then `npm run build` to verify `StockMind.jsx` renders and the IPC round-trip works end to end. |
| 49 | Genome hot-swap applier + verification report + auto-failover | done | Section 36. Modelled the master's architecture poster against the real codebase: mapped 8 concepts already built, closed 3 genuine gaps the diagram pointed at (genome proposals could not be applied; failover could be answered but not acted on; no verification step before a risky change), and explicitly declined 5 poster claims with no engineering referent (1.5T-param lattice, ZK-PoK, Monte-Carlo parallel universes, Coq proofs, infinite scaling) rather than fabricate metrics around them. `electron/lib/genomeApplier.cjs` registers the missing `GENOME` applier with a deep merge (verified: sibling axis untouched, locked-nucleus apply refused). `electron/lib/verifyProposal.cjs` attaches AST-based quality/issue reports to regen (before approval) and evolution (after approval, audit-only) proposals — verified a deliberately-bad file scores lower than a clean one. `selfCare.cjs` gained `checkInstanceFailover()`: auto-expresses a dormant gene on a sibling instance when an active instance needs a dead one, additive and reversible only, always notifies master. |
| 47 | Tier 3 auto-proposal of new reflexes | not started | `findReflexCandidates()` reports escalation counts by tool but does not yet synthesise a skill. Next step: when one phrasing cluster exceeds ~20 escalations with structurally identical answers, generate a `SKILLS` entry and file it as a `SELF_MODIFY` proposal (invariant I6 — never auto-applied). |
| 48 | Appearance panel in Settings | not started | Zoom is reachable by chat/voice command only. Next step: add a Voice + Appearance section to `Settings.jsx` with a zoom slider bound to `window.rama.appearance`, the voice level from ledger row 40, and `RAMA_WHISPER_PATH`. |
| 45 | Live reload | done | Section 34. Watching split by domain so each change does the least that makes it live: `src`/`shared`/`index.html` → HMR under Vite, otherwise rebuild + window reload; `electron/**` → restart the shell only; `server/**` → restart the API only; `package.json` → warn, never auto-install. Reload is signalled by `build/.reload` written *after* a clean `vite build`, because Vite empties `outDir` first and a watcher on `build/` would reload a half-written bundle. 250ms debounce per domain, in-flight rebuilds coalesce. `--no-watch` disables. Classification verified by 22 assertions. |
| 44 | Error containment + optional deps | done | Section 33. `ErrorBoundary` wrapped `AppShell`, so one page crash removed the titlebar and tab strip — the same symptom as "navigation is not working". Boundary moved inside the shell, keyed on route so it clears on navigation, names the failing module, and records to the experiential dataset. Separately `systeminformation` was required at the top of `system.cjs` and `resourceOrchestrator.cjs` while the launcher classified it as *degrading*, so an absent optional module crashed main-process startup. New `electron/lib/sysinfo.cjs` guards the require and implements a Node-only fallback (verified: real CPU/RAM/OS figures with the module absent). System page dereferences hardened. |
| 43 | Stale build + unreachable navigation | done | Section 32. Stage 4 reused `build/` without checking its age, so a stale bundle rendered pre-change code on every launch and made every fix look ineffective. `buildStaleness()` now compares build mtime against the newest source file; stage 4 rebuilds, `--diagnose` reports `build freshness`. Separately the tab strip defaulted to collapsed behind a 3px unlabelled target, so navigation was effectively invisible: it now opens by default (persisted) with a 22px labelled handle, and `goTo` no longer collapses it after every click. |
| 42 | "not a function" bug class | done | Found a real one: `App.jsx` destructured `setLastHealthCheck` from `appStore`, but it lives in `uiStore`, so the first health tick after login threw from inside the consciousness loop. Added `scripts/auditRenderer.cjs` (`npm run audit`) which statically checks every Zustand destructure against the store's real keys and every `window.rama.<ns>.<fn>` against preload's surface — 21 destructures and 66 bridge calls, all resolving. Wired into `start.cjs` stage 1 so it runs on every boot. Preload exposure is now guarded: a `contextBridge` failure is reported to the main process, logged, and shown in the window instead of silently leaving `window.rama` undefined. |
| 41 | Mic modes + mute/unmute | done | Section 31. Two independent mutes (mic and speech), four mic modes, and hands-free segmentation via Web Audio RMS so "unmute and just talk" works at L2 without a wake word. Mic mute releases the OS device so the platform indicator goes out. `Ctrl+Shift+M` / `Ctrl+Shift+S`, right-click for the mode menu, voice commands for muting. Preferences persist in `localStorage` because they must be readable before the passcode gate. |
| 40 | Voice level surfaced on the Settings page | not started | The ladder is visible in the palette only. Next step: add a Voice section to `Settings.jsx` showing the level, the detected backend, a Re-check button (`window.rama.voice.rescan`), and inputs for `RAMA_WHISPER_PATH` / `RAMA_WHISPER_MODEL`. |
| 36 | Renderer entry / CSP / blank window | done | Section 29. Root cause of "Vite did not come up" and of first-run appearing to happen in the CLI: `index.html` was inside `publicDir`, so the dev server had no entry. Fixed by moving it to the project root and dropping the `rollupOptions.input` override. CSP moved to main-process headers (dev vs prod), which also un-blocks the Monaco CDN and HMR websocket. `main.cjs` now resolves dev server → build → inline diagnostic page and can never show a blank window. `start.cjs` readiness requires HTTP 200 **and** `id="root"`, and falls back to building the frontend. `diagnose()` gained `entry-missing` / `entry-duplicate` checks so this defect class cannot recur silently. |
| 30 | Wire `mustChangePassword` into the login flow | not started | `authCore` sets it on admin-created accounts and returns it from `loginStep1`, but no UI forces the change yet. Next step: after a successful gate 3, if `user.mustChangePassword` render a forced change-password screen before the app mounts. |
| 31 | Surface `auth:sessions` in the UI | not started | Handler exists and is gated on `audit.all`. Next step: add a Sessions panel to the Users page listing active sessions with revoke. |
| 32 | Instance ↔ account ownership | not started | `instanceManager.spawn({ owner })` accepts an owner id but nothing passes one. Next step: pass `currentUser.id` from `Genome.jsx` and filter `instance:list` by owner for non-admin tiers. |
| 33 | Genome-change applier | done | `electron/lib/genomeApplier.cjs` registers the missing `GENOME` applier on `proposals.cjs`'s ledger (`ledger.registerApplier(ledger.KINDS.GENOME, applyGenomeProposal)`), deep-merges the approved `nucleusPatch` into the sealed nucleus, and is wired into `main.cjs` (`genomeApplier.register()`). This row was stale — the work landed in Section 36 (see row 49) but the ledger entry was never corrected. |
| 34 | Resume protocol itself | done | This section, plus `.kiro/steering/rama-resume-protocol.md` (`inclusion: always`) so a cold session loads it without being told. |
| 35 | Key material excluded from git | done | `.gitignore` now covers `data/`, `*.enc`, `rama.salt`, `rama.verify`, `.nucleus.enc`, `.nucleus.salt`. Committing any of them would enable an offline attack on the passcode. |
| 52 | Resource research capability — catalog + doc-reading + enable proposals | in-progress | Section 38. `shared/resourceCatalog.json` (seed catalog across llm/voice/search/vector axes), `electron/ipc/resourceResearchEngine.cjs` (`resource:catalog`, `resource:research` — live doc fetch + heuristic price/rate-limit/credential extraction, `resource:propose-enable` — files a `KINDS.RESOURCE` ledger proposal, registered applier writes wiring only, never a secret), wired into `main.cjs` + `preload.cjs` (`window.rama.resourceResearch.*`) and a new Research tab in `Resources.jsx`. Tier gates added to `capabilities.json` (`resources.research`=2, `resources.propose-enable`=1). `npm run audit` clean (69 bridge calls resolve), `node --check` clean on all three `.cjs`. **Remaining**: `proposeEnable` requires the caller to already have the wiring diff in hand — it does not itself synthesise provider-integration code. Next step: wire a "draft the integration" action (chat/IDE-assisted, same authoring path as other self-modify proposals) that produces the `wiring.content` for `resource:propose-enable` from a research report, so the UI's "Propose enabling" button in the research tab has something real to call. `node_modules` is absent on this machine — `vite build`/renderer runtime not verified here, per the verification bar. |
| 53 | Release channel — dormant version-bump/tag/CI path for the auto-updater | done (inert by design) | Section 39. `electron/lib/releaseChannel.cjs` (`release:state`, `release:cut` — bump `package.json`, prepend `CHANGELOG.md`, commit, annotated tag, optional push; master-only via new `release.cut` tier-0 capability), `.github/workflows/release.yml` (fires only on a `v*.*.*` tag push, builds+publishes via `electron-builder --publish always` — does nothing until Actions is enabled on GitHub and a tag is actually pushed), and a Release tab on `GitSync.jsx`. Does not go through `proposals.cjs` — this is master directly using a tool, same category as git commit/push, gated by tier not by the self-modify ledger. `node --check` clean, `npm run audit` clean (71 bridge calls resolve). Nothing has been tagged or pushed; `autoUpdater` has nothing to find yet. Next step if master wants this live: enable GitHub Actions on the repo, decide on code signing (currently unsigned — SmartScreen/Gatekeeper warnings expected), then cut `v1.0.1` with `push:false` first to sanity-check the tag/changelog before pushing for real. |
| 54 | Local self-update — master's own local CI/CD (pull → install → build → apply, no external pipeline) | done | Section 40. `electron/lib/localUpdateEngine.cjs` (`checkForUpdates` read-only status, `pullBuildApply` — refuses on a dirty tree unless forced, pulls, classifies changed files with the same domain rule `start.cjs`'s live-reload watcher uses, installs only if deps changed, builds only if renderer changed, reports whether a restart or reload is needed without doing either itself), `registerLocalUpdate()` in `main.cjs` (the actual restart/reload actions — only the main process can do these safely), gated by new tier-0 `system.self-update` capability. Update + Release tabs both live on `GitSync.jsx` now. Does not go through `proposals.cjs` — master fetching their own already-committed code, same category as `git.cjs`'s pull/checkout. `node --check` clean, `npm run audit` clean (76 bridge calls resolve). Not exercised end-to-end (no second commit existed upstream this session) — logic verified by review against `start.cjs`'s proven `classifyChange`, not by a real pull. Next step: commit from another clone, then use the Update tab to confirm one real pull→build→restart cycle. |

| 55 | Publish an applied self-modify proposal to its own branch, with release notes | done | Section 41. `electron/lib/publishProposal.cjs` — pushes an already-`applied` proposal's changes to `self-modify/<date>-<slug>-<id>` (never `dev`/`source` directly), with generated release notes (structured facts always; AI explanation appended opportunistically via `modelRouter.cjs`, degrading silently to structured-only). Master-only (`release.cut`, same gate as cutting a version release — I6 unchanged, ledger approval already happened before this runs). Verified end-to-end against a disposable scratch repo: `dev` untouched, new branch has the files + notes, working tree returns to the starting branch automatically. Wired into `Evolution.jsx`'s ProposalCard as "⎇ Publish branch". `npm run audit` clean (78 bridge calls). Not yet exercised against a real remote with `push:true`, and not yet surfaced in `Resources.jsx`'s research tab for RESOURCE-kind proposals. |

| 56 | Custom OpenAI-compatible LLM providers — any current/future model host, without a code change | done | Section 42. `electron/lib/customProviders.cjs` (`add`/`remove`/`list`/`toRegistryEntries`) + `modelRouter.cjs`'s new `customChat()` generic adapter, merged into `MODEL_REGISTRY` at `models:list`/`selectModel` time so every existing routing/fallback/rate-limit mechanism applies with no special-casing. Security: no agent-callable path (verified — not referenced in `agentOrchestrator.cjs`'s closed action switch), master-only via `models.add-key` (tier 1, same gate as any provider key), credentials never leave `credentialVault.cjs`, SSRF-guarded base-URL validation (rejects localhost/private/link-local/169.254.169.254 unless explicitly allowed), no `proposals.cjs`/self-modify path. `node --check` clean on all 5 touched `.cjs`, `npm run audit` clean (81 bridge calls). New "Custom" tab on `Models.jsx`. Not exercised against a real third-party endpoint in this session — verified by mocked add/list/remove round-trip and 8 URL-validation cases, not a live call. |

| 57 | Metrics no longer stale; Rāma's own resource footprint | done | Section 43. Root cause: `systeminformation` spawns a fresh `powershell.exe` per call on Windows without a persistent session (2-13s cold vs 150ms-2s warm, measured). `sysinfo.cjs` now starts one at load, released on quit. Both polling loops (streaming handler, `System.jsx`'s 5s poll) now self-pace instead of firing on a fixed timer regardless of latency. New `system:get-own-footprint` (Electron's `app.getAppMetrics()` + Rāma's external child PIDs looked up live) + a "Rāma's own footprint" panel on the System page. Verified end-to-end via direct handler invocation; not tested on the specific machine that reported the symptom. |
| 58 | App assimilation capability gate | done | Section 44. `appAssimilation.cjs`'s `apps:view`/`apps:execute-safe`/`apps:execute-all` handlers gated on the existing `apps.view`/`apps.execute-safe`/`apps.execute-all` capabilities via `capability.deny()`. `preload.cjs` updated to pass `user` through. UI page/registry entry remains a separate, deferred follow-up — not built this pass. |
| 59 | Full codebase audit and security-gate pass toward the spec's own capability matrix | done | This pass closed the gap between `shared/capabilities.json`'s defined tiers and what was actually enforced. Fixed a live bug: `models:ollama-pull` referenced bare `http`, never required — `lib/http.cjs` gained `postStreamingJsonLines()` (I9-compliant) to fix it. Fixed an I9 violation in `main.cjs`'s `probeVite()` (raw `require('http').get()` → `lib/http.cjs`). Added `capability.deny()` (non-throwing `{ok:false,error}` gate) to stop each IPC file hand-rolling tier checks inconsistently. Gated, end to end (handler → `preload.cjs` → `ipcClient.js`/direct `window.rama.*` callers → every `.jsx` caller updated with `currentUser`): `terminal:create` (`terminal.open`), all of `filesystem.cjs` (`os.filesystem-read/write/delete`), all of `git.cjs` (`git.read/commit/push`), `system.cjs`'s process/kill/network/temp-clean handlers (`os.process-list/process-kill/temp-clean`; `get-metrics`/`get-disk-usage`/`get-temp-targets`/`get-own-footprint` deliberately left open, same sensitivity class as the Home dashboard's `VIEWER` tier), all of `credentialVault.cjs` (`vault.read/write/unlock` — previously ZERO check despite being tier-0/master-only in the matrix; any signed-in user could unlock/read/write/delete any credential before this fix), `agentOrchestrator.cjs`'s spawn/kill/kill-all/set-governor (`agents.spawn/kill-own/kill-all/governor-config`), `sandboxEngine.cjs`'s execute/approve/kill (new `sandbox.execute`=1 and `sandbox.approve`=0 capabilities added — arbitrary code execution up to ELEVATED tier had no gate at all). Fixed `server/index.cjs`'s Ghost Mode wipe endpoint: the prior check accepted any non-empty `x-session-token` from a local caller, validating nothing; now uses `requireLocalToken` (the per-boot `RAMA_SERVER_TOKEN` shared secret already built for exactly this case) instead of fabricating a session check the server has no way to honestly perform. Removed two dead UI toggles in `Settings.jsx` ("Minimize to tray", "Voice wake word") that rendered as fixed-on switches with no-op `onChange` — neither has real backing state; replaced with an explanatory note. `node --check` clean on every touched `.cjs`; `node scripts\auditRenderer.cjs` clean throughout (81 bridge calls resolve). **Not done in this pass** (deferred, see rows 30–32, 40, 47, 48, 52): the confirmed-not-started feature-gap rows are unrelated to this security pass and were left for a separate session. |

| 60 | Build anywhere from source — self-preparing packaging pipeline | in-progress (cause of the installer failure found and worked around; unbranded-installer rung unverified) | Section 45. Two faults found: (a) `Rama.bat` option 2 called `npm run build:win` directly, so a fresh clone with no `node_modules` died on `'vite' is not recognized` — the packaging path never used `start.cjs`'s existing diagnose/install machinery; (b) on the work machine the real blocker is BeyondTrust endpoint policy refusing to start `7zip-bin@5.2.0`'s `7za.exe` (7-Zip 21.07, flagged "Vulnerable Application Version") — the process is never created, and no system 7-Zip exists. Confirmed by reading installed `electron-builder@24.13.3`: `nsis` and `portable` both need 7za (`archive.js:48/173`, `NsisTarget.js:217`), `--dir` does not. `vite build` succeeds here, so the renderer half was never at fault. Building `scripts/buildInstaller.cjs`: stage 0 toolchain/disk, stage 1 deps derived from `package.json` with exact-version checks and a 4-rung install ladder (`npm ci` → `install` → `--legacy-peer-deps` → `--ignore-scripts`), stage 2 unconditional `vite build`, stage 3 archiver capability ladder (bundled → system 7-Zip staged over `7zip-bin`'s path → none), stage 4 `electron-builder` with target set chosen by rung, stage 5 honest artefact report. `npm run build:win` kept unchanged as the raw escape hatch (I11). Built and verified: `Rama.bat` option 2 now calls the script; new `package`/`package:win`/`package:mac`/`package:linux`/`package:check` npm scripts. Three findings only running it could produce, all recorded in Section 45: (i) starting the blocked `7za.exe` **terminates the calling process** (0xC0000003, nothing after the `spawnSync` runs) — the probe had to be moved into a throwaway child process, since no error handling in-process could ever catch it; (ii) `electron-builder --dir` is **not** 7za-free as the first reading of the source suggested — it extracts `winCodeSign-2.6.0.7z` for the sign/edit-executable step even with no certificate, so the fallback rung also passes `-c.win.signAndEditExecutable=false` (cost: default `.exe` icon/metadata, stated in the report); (iii) the first native check gave a false positive — `require('node-pty')` succeeds while `node_modules/node-pty/build` holds no `.node` at all, so the check now looks for a real platform-matching binary. Also added a remembered-verdict memo (`data/system/archiver-probe.json`, gitignored, fingerprinted by size+mtime) so the blocked binary is started at most once ever and the master stops seeing BeyondTrust dialogs; `--recheck-archiver` forces a re-test. `node --check` clean. Verified end to end on the blocked machine: exit 0, 114.5 MB `Rama-AGI-1.0.0-win-unpacked-portable.zip`, 604 entries including `Rama AGI.exe` + `app.asar`, no dialog raised. **Master's personal machine: the pipeline works, the installer step fails.** A photo of that run shows it completing into a 129.7 MB portable zip via the salvage path, failing *after* the app tree was packed — so dependencies, the renderer, the archiver and packing are all fine there, and only the NSIS/portable targets fail. Fixed as a result: (a) the salvage branch was overwriting the archiver verdict with level 2, so the report told a machine with a working 7-Zip that it had none and advised installing it — the verdict now passes through, salvage is its own reported state, and the failing command's last 12 lines print at the *end* of the run where a screenshot catches them (verified against a patched throwaway copy with a faked verdict, so nothing had to start the blocked binary); (b) two real defects in `assets/installer.nsh`, a file that had never been compiled by `makensis` anywhere — it used `productName`/`version`, which are electron-builder artifactName placeholders and not NSIS defines (correct names are `PRODUCT_NAME`/`PRODUCT_FILENAME`/`VERSION`, per `Defines.js:154-158`), so the `rama://` handler would have been registered pointing at a literal unexpanded filename; and it was UTF-8 with no BOM carrying 475 non-ASCII bytes, which NSIS reads in the system codepage. Now ASCII-only with the constraint documented in-file. Cleared as a suspect: `MUI_WELCOMEPAGE_*` cannot collide — electron-builder's templates never reference it. Neither `.nsh` defect is *confirmed* to be the failure; both are warnings-not-errors in principle. **CAUSE FOUND.** The fixed report earned its keep on the next run: `Cannot create symbolic link : A required privilege is not held by the client` while 7-Zip extracted `winCodeSign\...7z`. electron-builder's winCodeSign bundle contains macOS symlinks (`darwin/10.12/lib/*.dylib`), and creating a symlink on Windows needs `SeCreateSymbolicLinkPrivilege`, which a standard account lacks unless Developer Mode is on. It fails *after* the app tree is packed, which is why it read as a packaging fault for three rounds — and the misattribution was my reporting bug, not the environment. Three responses, all in `buildInstaller.cjs`: (1) stage 0 now probes symlink creation in a temp dir and, if denied, states before the build that the installer step will fail, with the two real fixes (Developer Mode, or an elevated terminal) — the probe reproduces `EPERM` on the work machine, so detection is verified against the very condition it targets; (2) a new rung between "installer" and "portable": on a failure matching the symlink signature the installer is retried with `-c.win.signAndEditExecutable=false`, which is the only reason winCodeSign is fetched, so this yields a **real NSIS installer** at the cost of an unbranded `.exe` (rcedit lives in the skipped step) — reported explicitly; portable-zip salvage is now the third rung; (3) the failure classifier matches the master's exact error text and not unrelated NSIS errors (both directions verified). Separately, stage 0 now statically validates `assets/installer.nsh` — encoding without BOM, `${lowerCase}` symbols that NSIS cannot expand, unbalanced `!macro`/`!macroend` — verified against a deliberately broken copy (107 non-ASCII bytes, `${productName}`, `${version}`, one unclosed macro all flagged; repaired file passes). Next step: re-run on the master's machine. Expected either a branded installer (if Developer Mode gets enabled) or an unbranded one via rung 2. **Still unverified anywhere:** a completed NSIS installer, since this machine has no runnable 7-Zip at all, and the rung-2 claim that `signAndEditExecutable=false` avoids winCodeSign during a *full NSIS* build — it is verified only for `--dir`. Optional follow-up if the work machine ever needs installers: an opt-in rung that downloads a pinned, checksum-verified current 7-Zip; deliberately not built without master's say-so, since it means fetching and executing a binary. |

### Resume checklist for a cold session

1. Read sections 23–28 of this document.
2. `git log --oneline -8` — confirm which ledger rows are actually committed.
3. `node start.cjs --diagnose` — see what the environment is missing.
4. Pick the first ledger row that is not `done` and follow its stated next step.
5. Before writing code, confirm the change does not violate a locked invariant.
6. On completion: update the row, write the next step, commit to `dev` and `source`.

---

## SECTION 29 — Renderer entry, CSP, and never showing a blank window

### The fault that made the UI unreachable

`index.html` lived in `public/` and `vite.config.js` set `publicDir: 'public'`.
Vite resolves the dev entry as `<root>/index.html`, so with `root: '.'` there was
no entry at all: the dev server answered on 5173 but had nothing to serve at `/`.
Production happened to work because `rollupOptions.input` pointed at
`public/index.html` explicitly. So the build was fine and dev was empty — which
is why first-run setup appeared to happen "in the CLI": the window had nothing
to render, leaving the launcher as the only thing reporting anything.

Putting `index.html` inside `publicDir` is a second, independent mistake — Vite
copies `publicDir` verbatim into `outDir`, so the entry would also be emitted
untransformed alongside the real one.

**Decision:** `index.html` sits at the project root, which is Vite's convention.
`publicDir: 'public'` stays for genuine static assets (icons), and the
`rollupOptions.input` override is removed so dev and build resolve the *same*
entry. One entry, one resolution path, no divergence between modes.

### CSP moves from a meta tag to response headers

The meta CSP shipped `script-src 'self' 'unsafe-inline'`, which silently blocked
two things:

- `cdn.jsdelivr.net` — so the IDE's Monaco editor never loaded and quietly fell
  back to a plain textarea
- the Vite HMR websocket — `connect-src` had no `ws:`, so hot reload could not
  connect even once the entry was fixed

**Decision:** CSP is set by the main process via `onHeadersReceived`, with a
different policy for dev and production. Two reasons this is better than a meta
tag:

1. A header cannot be neutered by injected markup, so it is strictly stronger.
2. Dev needs `ws:` and Vite's origin; production must not have them. A single
   static meta tag cannot be correct for both, and the version that "works
   everywhere" is the loosened one.

Production policy keeps `script-src 'self'` plus the Monaco CDN and nothing else.
Dev adds the Vite origin and `ws:`.

### The window must never be blank

`createMainWindow` loaded the Vite URL unconditionally when `RAMA_DEV=1`. If Vite
was not actually serving the app, the result was a blank window with the failure
visible only in the terminal.

**Decision:** loading is a resolution sequence, and its last step always renders
something:

1. In dev, probe the Vite URL. If it answers with the real entry, load it.
2. Otherwise, if `build/index.html` exists, load that and say so in the window.
3. Otherwise render an inline diagnostic page — served from a data URL, needing
   no bundle — that states what was tried, what failed, the exact command that
   fixes it, and a Retry button.

Startup failure is therefore reported *in the UI*, not only in the CLI. This is
the same principle as the genome report: state what is actually true rather than
assume the happy path.

### Readiness checks must check readiness

`start.cjs`'s `waitForPort` resolved `true` on *any* HTTP response, including
Vite's 404. A dev server with no entry was reported as ready.

**Decision:** the Vite check requires HTTP 200 **and** the entry marker
(`id="root"`) in the body. Answering the socket is not the same as serving the
app. When the check fails, stage 4 builds the frontend and switches the shell to
the built files rather than opening a window onto nothing.

---

## SECTION 30 — Routing over file://, and the progressive capability ladder

### Why every tab was dead

`App.jsx` used `BrowserRouter`. When the shell loads the renderer with
`loadFile()`, the page origin is `file://`. Chromium refuses `history.pushState`
with a path on a `file://` origin — it throws a `SecurityError`. So
`navigate('/system')` did nothing at all: no route change, no error the user
could see, every tab a no-op.

This was invisible in dev because the Vite dev server serves over `http://`,
where `pushState` is legal. It only appeared once the build became the loaded
renderer — the same divergence between dev and production that section 29 was
about.

**Decision:** `HashRouter`. Routes become `#/system`, which needs no History API
and behaves identically over `http://` and `file://`. One router for both modes,
so dev cannot pass while production is broken. `MemoryRouter` would also work but
loses deep links and reload-in-place, both of which Rāma uses (tray navigation,
the palette, and `did-fail-load` recovery).

### Progressive capability ladder

> "It should have min capabilities before using other resources so that it can
> progress towards it."

This is the general principle already used by the staged launcher (section 26)
and the genome (section 24), stated as a rule for *features*:

**A capability starts at the level that needs nothing, works there, and climbs
only when a resource it needs is actually present. It never silently does
nothing, and it always reports which level it is on and what the next level
needs.**

Three obligations follow for every laddered capability:

1. **Level 0 must require nothing** — no network, no native module, no API key.
   If level 0 does not work, the capability is broken, not degraded.
2. **Climbing is detected, not assumed.** Presence of a resource is measured at
   runtime; a missing one drops the level rather than throwing.
3. **The current level is visible in the UI**, together with what the next level
   requires. A silently absent capability is a bug regardless of the reason.

### Voice as the first laddered capability

Voice was the clearest violation. `webkitSpeechRecognition` exists in Electron
but always fails with `network`, because Chromium is built without the Google API
keys Chrome ships with, and Google withdrew Web Speech support for non-Chrome
Chromium shells. The old engine auto-started continuous recognition on app load
and restarted 300ms after every `onend` — so in the desktop shell it sat in a
permanent failure loop, burning cycles and never once transcribing anything.

| Level | Name | Needs | Gives |
|---|---|---|---|
| 0 | TEXT | nothing | Ctrl+K palette, typed commands. Always works. |
| 1 | PUSH-TO-TALK | microphone permission + a transcription backend | Hold to speak, release to transcribe |
| 2 | LOCAL STT | a Whisper binary on PATH or configured | Private, offline, no cost |
| 3 | CLOUD STT | an OpenAI key in the credential vault | Highest accuracy |
| 4 | WAKE WORD | a continuous-capable local engine | "Hey Rāma" hands-free |

Resolution order for transcription is **local before cloud**: private and free
before accurate and paid. Level 4 is deliberately gated on a *local* engine —
streaming every ambient utterance to a paid API to listen for a wake word is the
wrong trade in both privacy and cost.

`webkitSpeechRecognition` stays as an opportunistic path, but it is probed once
and permanently disabled on the first `network` error rather than retried. In a
plain browser it works and grants level 4; in the desktop shell it does not, and
the ladder falls to whatever level the machine can actually support.

The mic button reports the live level and, on hover, exactly what the next level
requires — so the user learns "install Whisper" or "add an OpenAI key" from the
UI instead of from a silent non-response.

---

## SECTION 31 — Mic modes, mute, and hands-free without a wake word

### The gap

Section 30 built two ways to talk to Rāma and no way to *stay* talking to it:

- at level 4 the mic button toggled wake-word listening
- at levels 1–3 it was hold-to-talk only

So on any machine without a local Whisper engine there was no persistent
listening, and on every machine there was no mute — no single control to say
"stop listening to me" or "stop talking to me". For an assistant meant to be
always present, mute is not a nicety; it is the control that makes always-present
acceptable.

### Two independent mutes

They are deliberately separate. Conflating them means silencing Rāma's replies
also stops it hearing you, which is almost never what is wanted.

| Control | Meaning | Default |
|---|---|---|
| **Mic mute** | Rāma cannot hear. Tracks stopped, stream released, recogniser aborted. | unmuted |
| **Speech mute** | Rāma does not speak. TTS suppressed and any current utterance cancelled. | unmuted |

Mic mute releases the OS microphone rather than merely ignoring input, so the
platform's own mic-in-use indicator goes out. A mute that leaves the light on is
not a mute the user can trust.

### Three mic modes

| Mode | Behaviour | Available at |
|---|---|---|
| `off` | Nothing captured. | always |
| `ptt` | Hold the button to speak, release to transcribe. | L1+ |
| `hands-free` | Open mic; speech is auto-segmented on silence and each segment transcribed. | L2+ (needs a transcription backend) |
| `wake` | Passive listening for "Hey Rāma". | L4 only |

**Hands-free is the answer to "unmute and just talk" without a wake word.**
Segmentation uses Web Audio: an `AnalyserNode` computes RMS over the input, a
segment opens when the level crosses the speech threshold and closes after
~1.2s below it. No model, no network, no dependency — it works at level 2 wherever
transcription exists.

Guard rails, because an open mic that transcribes forever is a cost and privacy
risk:

- segments shorter than 400ms are discarded as noise
- a segment is force-closed at 30s so one continuous noise source cannot produce
  an unbounded clip
- a 250ms cool-down after each segment prevents an echo of Rāma's own TTS
  re-triggering capture
- hands-free is never the default; the user selects it

### Controls

| Trigger | Effect |
|---|---|
| Click mic | Toggle mic mute |
| Hold mic | Push-to-talk, regardless of mode (a direct request always works) |
| Right-click / long-press mic | Mode menu |
| `Ctrl+Shift+M` | Toggle mic mute |
| `Ctrl+Shift+S` | Toggle speech mute |
| Say "mute" / "unmute" | Mic mute (unmute only from a still-live session) |
| Say "stop talking" / "be quiet" | Speech mute |

Mode and both mute states persist across restarts, so the user sets their
preference once. Persistence is `localStorage` — a UI preference, not data, and it
must survive before the encrypted store is unlocked.

### One honest exception

Voice-driven *unmute* cannot work once the mic is muted, because the stream is
released and nothing is listening. The command is accepted while unmuted (it
would be a no-op) and the mic button tooltip states that unmuting is a
click or `Ctrl+Shift+M`. Pretending otherwise would be a capability that appears
to exist and never fires — exactly what section 30 was written to prevent.

---

## SECTION 32 — Stale builds, and navigation that can be found

### A stale build is worse than a missing one

Section 29 made the shell fall back to `build/` when the dev server will not
serve. Stage 4 then reused that build unconditionally. If the bundle was older
than the source, the window rendered **pre-change code on every launch** — so a
source fix appeared to have no effect, and the only reasonable conclusion from the
outside was that the fix did not work.

A missing build fails loudly. A stale build succeeds and lies.

**Decision:** staleness is measured, never assumed. `buildStaleness()` compares
the mtime of `build/index.html` against the newest file under `src/`, `shared/`,
`index.html`, `vite.config.js` and `package.json`.

- `--diagnose` reports `build freshness` in both dev and production mode, because
  dev falls back to the build too
- stage 4 rebuilds a stale bundle rather than loading it
- `--no-heal` refuses to rebuild but still says the build is stale and names the
  file that outdates it
- the log states the build's age, so "which code am I looking at" is never a guess

### Navigation has to be reachable

The sidebar was removed by design in favour of a collapsible tab strip. But the
strip defaulted to collapsed behind `Ctrl+K`, and the only pointer affordance was
a **3px** unlabelled strip. For anyone who did not know the shortcut there was no
visible way to move between pages — indistinguishable from broken navigation.

Two changes:

1. **Open by default**, with the choice persisted, so anyone who prefers it
   collapsed keeps that.
2. **The handle is a real target**: 22px, labelled `▾ NAVIGATION · Ctrl+K`,
   keyboard-focusable with Enter/Space.

Also: `goTo` used to call `closePalette()` after navigating. Since the strip is
the app's only navigation, that gave the user exactly one move before the way back
disappeared. It now clears the query and leaves the strip open.

### The general rule this is an instance of

Both faults share a shape with the voice ladder (section 30) and the passcode
verifier (section 27): **a mechanism that appears to work while doing nothing.**
Silent success is the failure mode to design against, which is why staleness,
capability level, and passcode correctness are all now measured and surfaced
rather than inferred.

---

## SECTION 33 — Error containment, and optional dependencies that were secretly fatal

### "MODULE CRITICAL FAILURE" was reporting the wrong scope

`ErrorBoundary` wrapped `AppShell`. So when one page threw during render, the
boundary replaced the titlebar and the tab strip along with the page. The result
was a full-screen red banner and **no navigation at all** — which is why this also
presented as "navigation is not working". One module's bug looked like total death.

Two changes:

1. **Scope.** The boundary now sits around the routed content only, inside the
   shell. A page crash leaves the titlebar and tab strip alive, so the user can
   navigate away from the broken module. A second, outer boundary still catches a
   genuine shell failure.
2. **Recovery.** A boundary latches `hasError` permanently, so navigating to a
   working page kept showing the old error. It now takes a `resetKey` (the current
   route) and clears on navigation.

The message also names the failing module from the registry ("SYSTEM FAILED"
rather than "MODULE CRITICAL FAILURE"), states that the rest of Rāma is
unaffected, exposes the component stack on demand, and records the failure to the
experiential dataset so render errors are measurable rather than merely visible.

### An optional dependency was required at load

`start.cjs` classifies `systeminformation` as **degrading**: without it Rāma should
lose thermal, GPU, battery and process detail, not stop. But it was required at the
top of both `electron/ipc/system.cjs` and `electron/resourceOrchestrator.cjs`, and
`main.cjs` requires both at load. An absent optional module therefore threw during
main-process startup and took the entire app down.

The classification said "degraded" while the code said "fatal". That gap is the
bug, and it applies to every optional dependency: **if a capability is declared
degradable, its require must be guarded and its fallback must exist.**

`electron/lib/sysinfo.cjs` guards the require and implements the Node-only level:

| Answerable from Node alone | Needs systeminformation |
|---|---|
| CPU load, per-core load, core count, model, speed | CPU temperature |
| Total / free / used memory | GPU controllers |
| Platform, release, arch, hostname, uptime | Battery |
| Network interfaces | Per-interface throughput, process list, FS throughput |

CPU load from `os.cpus()` needs two samples, since the counters are cumulative —
the first call reports 0 rather than inventing a figure, and the previous tick
counts are retained. Everything genuinely unavailable returns `null`/`[]` and
`status()` names the install command that restores it.

Verified with `systeminformation` absent: 16% CPU across 14 cores, 48% of 31.4 GB,
correct platform and hostname; temperature, GPU, battery and process list report
empty and say why.

### The System page no longer trusts its input

`p.name.toLowerCase()` threw for OS processes with no name, and a partial metrics
snapshot (one `systeminformation` call failing on a given platform) threw on
`m.cpu.cores.length`, `m.gpu[0]` or `m.network.map`. The snapshot is now normalised
once, every array is checked, and a failed fetch renders an explanation with the
install hint instead of sitting on "Loading..." forever.

---

## SECTION 34 — Live reload: the minimum action for what actually changed

### The problem

Every source edit required stopping and restarting the whole launcher. That is
four processes torn down and rebuilt — API, Vite, Electron, and the encrypted
store, which means re-entering the passcode — to pick up a one-line change in a
React component.

### The principle

**Do the least that makes the change live.** A renderer edit should not restart
the main process, and a main-process edit should not tear down the API. Watching
is therefore split by domain, and each domain has exactly one action:

| Changed | Vite live | Build mode | Restart cost |
|---|---|---|---|
| `src/**`, `index.html`, `shared/**` | nothing — HMR already applied it | rebuild, then reload the window | none |
| `electron/**` (incl. `preload.cjs`) | restart the Electron child only | same | window reopens; API and Vite untouched |
| `server/**` | restart the API child only | same | window unaffected |
| `vite.config.js` | Vite restarts itself | rebuild + reload | none |
| `package.json`, lockfile | **warn only** | warn only | manual `npm install` |

Dependencies are deliberately never auto-installed on a file change. An install
can take minutes and can break a working tree; that is a decision, not a reflex.

### Why a marker file rather than watching `build/`

`vite build` empties `outDir` before writing. A watcher on `build/` would fire
mid-build and reload the window onto a half-written bundle. So the launcher writes
`build/.reload` **after** the build process exits successfully, and the main
process watches that one file. The signal therefore means "a complete build is
ready", not "something in build/ moved".

`fs.watchFile` (polling, 500ms) is used rather than `fs.watch` because a file
replaced by a rename loses an `fs.watch` handle on Windows. One polled file is
negligible, and the watcher is only installed when the window is actually loaded
from the build.

### Guard rails

- 250ms debounce per domain, so a save that touches several files rebuilds once
- a rebuild or restart already in flight suppresses a new one; the last request is
  coalesced rather than queued
- `node_modules`, `build`, `data`, `.git` and dotfiles are excluded from watching
- the passcode is **not** re-requested for a renderer rebuild, because the main
  process and its unlocked store are never restarted for one
- an `electron/**` change does restart the shell, which does re-lock the store —
  unavoidable, since that is the process holding the keys. It is stated in the log
  so the re-prompt is never a surprise.
- `--no-watch` disables the whole mechanism; watching is on by default in dev and
  off in `--prod`

---

## SECTION 35 — The cognition ladder, and Rāma acting on itself

### The principle, restated for thinking

Sections 30 and 34 applied "start at the level that needs nothing" to voice and to
reloading. The same rule governs cognition, and it is the mechanism by which Rāma
climbs rather than merely runs:

| Tier | Name | Needs | Handles | Cost |
|---|---|---|---|---|
| 0 | REFLEX | nothing | its own state, appearance, navigation, system readings, muting | none |
| 1 | LOCAL | Ollama | reasoning, drafting, summarising, code | none, private |
| 2 | CLOUD | a vault API key | hard reasoning, research, long context | metered |
| 3 | LEARN | tier 2 history | turning a repeated tier-2 answer into a tier-0 reflex | none |

**Tier 0 must never call a model.** Asking Rāma to make its own text larger is not
a language problem; routing it to a cloud LLM would be slower, cost money, fail
offline, and — worst — fail while the vault is locked. Anything Rāma can do to
*itself* belongs at tier 0 by definition.

Escalation is strictly ordered and each step is recorded to the experiential
dataset with the tier that answered. That record is what tier 3 consumes.

### Tier 3 is the evolution mechanism

`metaCognition` already records `(action, context, outcome)` with the tool that
served it. When a phrasing repeatedly reaches tier 2 and the cloud answer is
structurally the same each time, that is evidence a reflex is missing. Tier 3
proposes a new skill through the existing proposal ledger — so Rāma's own
intelligence grows downward into the cheap tier over time, and every such change
still passes the master's approval gate (invariant I6).

This is the concrete answer to "keep evolving into a higher intellectual being":
capability is not a fixed set of tiers but a **flow of competence from expensive
tiers to free ones**, driven by measured evidence, gated by consent.

### Skills are declarative

A tier-0 skill declares its patterns, what it does, and what it says. It never
reaches the network and never blocks. The registry is data, so tier 3 can add to
it and `capabilities()` can enumerate it truthfully — the same measured-not-claimed
rule as the genome.

### Legibility was a real defect, not a preference

Text was illegible because the UI is built from hundreds of inline `fontSize`
values between 9px and 11px in a monospace face. Two consequences:

1. Raising the root `font-size` fixes nothing — inline pixel values ignore it.
2. There is no CSS rule that can raise a floor across inline styles.

**Decision: scale the whole surface rather than chase individual values.**
`webContents.setZoomFactor` scales every pixel in the renderer, inline styles
included, and is the mechanism Chromium provides for exactly this. In browser mode
the fallback is `zoom` on the document element.

Base tokens were raised too (13px → 14px, and the utility scale with it), so the
default is legible before any scaling is applied. Scaling then remains a
preference rather than a workaround.

Rāma can therefore be *told* to fix it — "make the text bigger", "zoom out",
"reset the zoom" — and does so at tier 0, with the setting persisted. That was the
second half of the request: the ability to ask it to improve its own UX.

---

## SECTION 36 — Reading the architecture poster against what is real

The master supplied an architecture diagram ("Universal Instantiation, Cryptographic
Loyalty & Self-Evolution Blueprint"). It is a mix of concepts already built, concepts
worth building, and poster language with no engineering referent. This section
records which is which, so a later session does not try to implement the third
category.

### Already built — the diagram is describing this system, correctly

| Diagram term | Real implementation |
|---|---|
| Rāma Supreme Genome / Universal AI DNA | `electron/genome.cjs` — 30 genes, 8 domains, holonic (section 24) |
| Master Keyphrase Anchor / Authorized Master | `authCore.cjs` three-gate auth + `nucleusSealer.cjs` (section 27) |
| Universal Instantiation (spawning engine) | `instanceManager.cjs` — `spawn()`, persisted, admission-gated |
| Task-driven differentiation (M_task) | `genome.expressedFor(role)` / `express()` — dormant gene activation |
| Limit-Breaker Engagement (anomaly detection) | `metaCognition.js` self-audit + `selfCare.cjs` regression detection (section 25, 33) |
| Neural Cellular Automata self-healing | `selfCare.cjs` health sweep + heal actions (partial — see below) |
| Holonic resilience ("each part is the whole") | the genome's core design: every instance carries every gene |
| Infrastructure / tooling / orchestration stack | sections 1–22 — Express, Electron, IPC layer, resource orchestrator |

### Genuinely missing — worth building, and buildable honestly

| Diagram term | What it actually means here | Built in this pass? |
|---|---|---|
| Genome hot-swapping (verified capability merge) | `proposals.cjs` `KINDS.GENOME` had no registered applier — a genome-change proposal could be approved but never applied | yes — `electron/lib/genomeApplier.cjs` |
| Self-healing lattice / morphogenetic healing / replacement | `failoverCandidates()` could answer "who could take over" but nothing acted on it | yes — auto-failover in `selfCare.cjs`, notified and reversible |
| Formal proof generator (honest version) | not theorem proving — a verification report (AST quality + impact) attached to a proposal before a human approves it | yes — `attachVerification()` in the proposal creation path |

### Poster language not implemented, and why

- **"1.5T parameter neural lattice"**, **"+342% epigenetic pruning"**, **"27.2ms inference
  throughput"** — no basis. Rāma routes to existing model APIs and Ollama; it does not
  train or host a 1.5T-parameter model. Inventing a metrics dashboard around numbers
  with no measurement behind them would violate the project's own rule (section 24, 33):
  measured, never claimed.
- **Post-quantum ZK-PoK** — the real auth is Argon2id + HKDF + HMAC-bound sessions
  (section 27), which is solid but is not a zero-knowledge proof system. Labelling it ZK-PoK
  would be a false claim about the cryptography in use.
- **Monte Carlo Synthetic Sandbox (parallel simulation universes)** — `sandboxEngine.cjs`
  runs one execution at a time with resource admission and tiered approval (section 24).
  Running N parallel simulated universes to Monte-Carlo a decision is a real idea but a
  large one; it is not attempted here. What ships instead is the verification report above,
  which is the honest, buildable slice of the same intent: know more before applying a change.
- **Coq theorem proving** — no formal verification toolchain is wired in. The AST-based
  quality/impact check is real static analysis, not a machine-checked proof, and is
  described as such.
- **"Infinite task scaling"** — capacity is bounded and stated: `MAX_INSTANCES = 8`,
  `MAX_AGENTS = 10`, admission-gated by `resourceOrchestrator`. Claiming "infinite" would
  contradict the project's own admission-control design.

### What was added

1. **`electron/lib/genomeApplier.cjs`** — registers the `GENOME` proposal kind with an
   applier that patches the sealed nucleus via `nucleusSealer.patchNucleus` and marks
   `requiresRestart`. A genome change is high-risk by definition (it can alter loyalty,
   ethics, or capability wiring), so it goes through the same single approval gate as
   every other self-change (invariant I6) — nothing new is exempted.

2. **Auto-failover in `selfCare.cjs`** — when a health sweep finds a dead gene the active
   instance needs, it checks `failoverCandidates()` for another live instance that already
   holds it dormant, and expresses it there automatically. This is deliberately **not**
   gated behind a proposal, for the same reason `disable-vector` already auto-applies:
   expressing a dormant gene is additive and reversible (it does not delete anything, and
   `express()` already refuses to exceed the owning tier's authority). Master is still
   always notified — "never self-heal silently" is selfCare's own founding rule, and this
   does not get an exception either.

3. **Verification report (`electron/lib/verifyProposal.cjs`)** — runs `astEngine.analyzeFile`
   on each file a proposal would write and records quality score + issues into
   `proposal.meta.verification`. Advisory only; it never touches `proposals.apply()`'s
   approval invariant.

   Timing differs honestly by engine, because only one of them has a hook that runs
   before approval with real file content:
   - `codeRegenEngine`'s `regen:set-fix` is the point the AI-generated fix becomes real
     content, and it runs **before** the proposal can be approved — so for regen
     proposals the master sees the report while deciding.
   - `evolutionEngine` has no synthesis step yet that fills `changes` before apply (see
     ledger — evolution proposals are created with `changes: []`), so its verification
     runs inside the registered applier, **after** approval, as a recorded audit note
     rather than as input to the decision. This is stated plainly rather than implying
     parity between the two engines.

---

## SECTION 37 — Creative Agent, refinement loop, and a real internal economy

### What the second diagram showed, honestly assessed

A swimlane diagram of an orchestrator delegating to Search/Research/Creative/
Summarizer agents, with an inline "evaluate credibility → adjust tone → optimize
for engagement" loop, labelled "internal agent economy." Section 36's method
applies again: map what is real, build what is missing and buildable, decline
what has no honest engineering referent.

Findings before this pass:
- Orchestrator delegating to typed agents — real (`agentOrchestrator.cjs`)
- Research agent — real, by name
- Source credibility scoring — real, but lived in `intelligenceEngine.cjs`,
  structurally separate from the agent loop the diagram shows it inside
- Creative agent — **missing**, no such type existed
- Iterative refine-against-a-metric loop — **missing**, agents ran once and
  returned; nothing scored its own output and revised
- "Internal agent economy" — **missing**, and worth being precise about what
  that phrase can honestly mean here (see below)

### Creative Agent

Added as a fifth content-producing type alongside research/code/data, with its
own system prompt (tone, audience, format-following, explicit "no unsupported
claims" instruction — creative agents drafting copy are the type most tempted to
invent facts, so the guardrail is in the prompt itself).

### The refinement loop — real, bounded, and honestly labelled

`refineOutput()` is a genuine iterate-until-good-enough loop:

1. Score the current draft against a metric (see below)
2. If the score clears the bar, or the iteration cap is hit, stop
3. Otherwise, ask the model to revise specifically against the score's stated
   weaknesses, and loop

Two metrics are implemented, matching the two the diagram actually shows:

- **credibility** — reuses `intelligenceEngine`'s existing `SOURCE_CREDIBILITY`
  scoring rather than inventing a second one. A research/creative agent's draft is
  scanned for cited domains and scored by the same table Rāma already trusts for
  fact-checking, so there is exactly one credibility opinion in the system, not two
  that can disagree.
- **legibility/audience-fit** — a plain readability heuristic (sentence length,
  jargon density against a small stopword-style list, passive-voice ratio). This
  is the honest, buildable version of "adjust tone for target audience": Rāma has
  no measure of *engagement* (that requires real audience data this system does
  not have and will not fabricate), but it can measure and improve *readability*,
  which is the mechanism most "adjust tone" requests actually want.

**What was deliberately not built:** an "engagement" score. There is no metric for
engagement without real audience response data, and inventing a proxy number and
calling it "engagement" would be exactly the kind of fabricated-metric the project
declined in section 36 (the 1.5T-parameter lattice, the +342% pruning). Readability
is offered instead, named as what it is.

The loop is capped at 3 iterations and each attempt is recorded as a step, so a
runaway "keep trying to be more engaging" loop cannot happen and the full history
of drafts is visible in the agent's step log — nothing is silently rewritten.

### "Internal agent economy" — the honest version

An economy implies scarcity, allocation, and a currency. Rāma already has exactly
that, just not under this name: `resourceOrchestrator`'s CPU/RAM/thermal admission
gate, the per-type instance caps in `AGENT_TYPES`, and the priority queue in
`resourceOrchestrator.PRIORITY`. What did not exist was a way for an agent's
*history* to affect its future priority — an economy needs feedback, not just a
fixed price list.

`agentOrchestrator` now tracks a lightweight reputation score per agent type,
fed by the existing experiential dataset: an agent type whose runs tend to
complete successfully earns a small priority boost on its next spawn; one that
times out or errors repeatedly is deprioritised, never blocked outright (a
struggling agent type still gets to run — it just doesn't jump the queue ahead of
a reliable one under contention). This is deliberately modest: no currency
changes hands, no agent can spend or transfer anything, and the effect is capped
so it can shift queue order under contention but can never grant an admission
`resourceOrchestrator.admit()` would otherwise refuse. That refusal remains the
one authority (invariant I10).

This is named "reputation-weighted scheduling," not "economy" — the word
"economy" implies more than a priority nudge, and section 36's discipline about
not overstating a mechanism applies here too.

---

## SECTION 38 — Resource research: free/premium catalog, live doc-reading, and enable-by-proposal

> Master's ask: Rāma should know what free and premium resources exist for an
> AGI/ASI system like itself, be able to read a resource's actual online
> documentation on demand rather than rely on stale training data, and hand
> master everything needed to decide and enable it — never enabling anything
> silently. Framed against Jarvis as a baseline, with the explicit instruction
> that Rāma's *capability* should have no artificial ceiling when master asks
> for something; if a capability is genuinely missing, Rāma upgrades its own
> code to acquire it, through the existing proposal gate, not around it.

### Why this is not "give Rāma an API key and let it decide"

Two invariants already say what the answer has to look like before a line of
code is written:

- **I6** — nothing is written to Rāma's own source without an approval recorded
  in the ledger. Wiring a new provider into `modelRouter.cjs` or
  `resourceOrchestrator.cjs`'s `API_RATE_LIMITS` is a source change.
- **I10** — `resourceOrchestrator.admit()` is the one admission authority. A
  research pipeline that fetches docs is cheap and needs no gate; anything it
  spins up that costs real CPU/RAM/network (a Playwright session, a heavy crawl)
  goes through `admit()` like every other engine, not a bespoke check.

So "enable a resource" is always **research → proposal → master decides →
apply → (if a secret is needed) master enters it into the vault.** Rāma never
holds the pen on its own credentials or its own wiring code; it holds the pen on
finding out what's needed and drafting the change for master to approve.

### Research: what's actually out there right now (Aug 2026)

Pulled from current docs/pricing pages, not training-data memory — this is the
kind of lookup the new capability itself should be doing at runtime instead of a
human doing it once and the answer going stale.

**LLM inference (`modelRouter.cjs` already has openai/anthropic/gemini/groq/mistral/ollama):**

| Provider | Free tier | Paid | Notes |
|---|---|---|---|
| Groq | No card required, full model catalog, rate-limited (~30 RPM on smaller models) | ~$0.05/1M tok (Llama 3.1 8B) up | Cheapest/fastest inference; already in `API_RATE_LIMITS`. |
| Google Gemini | 5,000 free requests/mo shared across 3.x models; 5–15 RPM depending on model | Flash-Lite $0.10/1M in, up to 3.1 Pro $2/1M in | Free tier is real but stingy at higher RPM; already registered. |
| OpenRouter | ~14 rotating `:free` model IDs (Llama, Nemotron, Hy3 etc.), one key, no card | Pay-per-model, no markup beyond upstream | **Not yet in `modelRouter.cjs`.** Single integration point gives Rāma many free fallback models instead of one. Good candidate for a first proposal. |
| Anthropic | Free consumer tier exists (chat only); API has no free tier | Sonnet 5 $3/$15 per 1M tok (in/out), Haiku 4.5 $1/$5 | Already registered; premium-only for API. |
| OpenAI | No free API tier | GPT-5.6 family, sub-$1/1M for mini/nano variants | Already registered; premium-only for API. |
| Ollama | 100% free, local, no key | — | Already registered; the "level 0" fallback the whole model-router leans on under pressure. |

**Voice (voice ladder is Section 30 — L0–L4):**

| Resource | Free | Premium | Fit |
|---|---|---|---|
| Local Whisper (whisper.cpp) | Free, offline | — | Already the L2 target; no new integration needed. |
| ElevenLabs (TTS) | Free tier ~10k credits/mo | ~$0.10/1k chars (Multilingual), $0.05/1k (Flash/Turbo); most expensive mainstream TTS | Not integrated. Would sit alongside the existing voice ladder as an *output* (speech) upgrade, not the STT input ladder — a different axis than L0–L4. |
| OpenAI/Google TTS | No dedicated free tier | Lower per-char cost than ElevenLabs (~$10-15/1M chars vs ElevenLabs ~$100-200/1M) | Cheaper premium alternative if voice quality from ElevenLabs isn't required. |

**Web research / search (`intelligenceEngine.cjs`, `browserEngine.cjs` currently do DDG API + DOM scraping):**

| Resource | Free | Premium | Fit |
|---|---|---|---|
| Tavily | 1,000 credits/mo free, no card; also a fully keyless tier for basic search/extract | $30/mo for 4,000 credits, or $0.008/credit PAYG | Purpose-built for LLM/agent consumption (structured, RAG-ready) — a real upgrade over the current DOM-scrape fallback in `browserEngine.search`. |
| Exa | ~20,000 free requests/mo | ~$7/1,000 requests | Larger free allowance than Tavily; worth comparing in the research report before proposing either. |
| DuckDuckGo Instant Answer API | Free, unlimited, no key | — | Already integrated (`intelligenceEngine.fetchDDGAPI`) — the correct L0 for this axis, keep as the no-key fallback. |

**Vector memory (`vectorMemory.cjs` — upgrade layer per ledger row 18):**

| Resource | Free | Premium | Fit |
|---|---|---|---|
| Qdrant | Self-hosted is free and open-source (Apache-2.0); no vector-count cap other than hardware | Qdrant Cloud from ~$25/mo | Matches the project's existing "local before cloud" doctrine (Section 30) — self-hosted Qdrant would be the natural upgrade path over an in-memory/keyword fallback, no premium key required at all. |
| Pinecone | Free tier exists but "got stingier" per 2026 sources | Usage-billed, no self-host option | Zero-ops but closed-source and no local fallback — conflicts with I11 (every engine needs a working fallback) unless paired with a local option anyway, which makes Qdrant the more consistent first choice. |

None of this is committed to code by writing this section — it is the research
artifact a cold session (or Rāma itself, at runtime) should produce, matched
against `shared/capabilities.json` and the existing registries, before any
proposal is drafted.

### Design: the capability itself

**New engine — `electron/ipc/resourceResearchEngine.cjs`.** Same shape as
`evolutionEngine.cjs` (scout → read → analyze-and-propose → ledger), aimed at
*resources* (APIs/services) instead of *repos*:

1. **`resource:catalog`** — returns a static-but-editable seed list
   (`shared/resourceCatalog.json`) of known resources per axis (llm, voice,
   search, vector, etc.) with what's already wired (cross-checked against
   `modelRouter.MODEL_REGISTRY` / `resourceOrchestrator.API_RATE_LIMITS` /
   vault `vault:has`) so the UI can show *enabled / researched / unknown* per
   entry instead of Rāma re-discovering the obvious every time.
2. **`resource:research(resourceId | url)`** — the live-doc-reading step master
   asked for. Fetches the resource's actual pricing/docs page via
   `browser:fetch-url` (cheap path) or `browser:open-page` + `get-content` if
   the docs are JS-rendered, extracts: auth scheme, required credential
   name(s), free-tier limits, paid pricing, rate limits, and endpoint(s) needed.
   Read-only — no gate needed, mirrors `intelligenceEngine`'s pipeline. Result
   is a structured report, not a decision.
3. **`resource:propose-enable(researchReport, targetIntegration)`** — turns a
   research report into a `proposals.create()` call. `changes[]` contains the
   actual wiring diff (new `MODEL_REGISTRY` entry, new `API_RATE_LIMITS` entry,
   or a new small adapter file under `electron/lib/resources/<name>.cjs`) —
   never the secret. `meta` carries the full research report so master sees
   exactly what a resource needs and costs before deciding, same pattern as
   `evolutionEngine.buildEvolutionProposal`'s `licenseNote`/`improvementAxes`.
   Registers a new ledger kind, `KINDS.RESOURCE`, with its own applier that
   writes the wiring file(s) and — if `verifyProposal` is available — attaches
   a quality report, same as every other kind.
4. **After `proposals.apply()` succeeds**, if the resource needs a credential,
   the UI prompts master to paste it once; it goes straight to
   `vault:set(service, value)` in `electron/ipc/credentialVault.cjs` — never
   through the ledger, never through `changes[].content`. This is the same
   split evolutionEngine already draws between "license-checked code change"
   and "the actual secret," just made explicit for resources.

**UI** — add a `research` tab to the existing `/resources` page
(`src/pages/Resources/Resources.jsx`) rather than a new registry entry: it
already owns the resource-governance space per `registry.js`, and I7 says one
page owns this domain. The tab shows the catalog, a "research this" action per
entry (or an arbitrary URL master pastes in), the resulting report, and a
"Propose enabling" button that calls `resource:propose-enable` — from there it's
the same `Proposals` review UI every other kind already uses.

**Tier gating** — add to `shared/capabilities.json`: `resources.research`
(read-only doc-fetch, tier 2 — ADMIN, matches `models.add-key`'s tier 1
neighbourhood but slightly looser since it's read-only) and reuse
`self-modify.apply`/tier 0 for the actual enable step, since applying the
proposal writes source.

**On "no limitation to its capability when asked"** — the mechanism for that is
already built and is not being reinvented: `evolutionEngine`'s self-assessment →
scout → propose → approve → apply pipeline is exactly "Rāma upgrades its own
code to do the task." This resource-research engine is the same shape, aimed at
*integrations* instead of *algorithms*. What master's phrasing does **not**
override is I6 — "no limitation" means no artificial *capability* ceiling, not a
bypass of the one approval gate that exists so a compromised or wrong proposal
can't silently rewire the AGI's own source or drain a credential. Raising that
tension explicitly rather than quietly building an auto-apply path, per the
resume protocol's working agreement.

### Status

Design recorded; not yet implemented. First concrete step on resume: create
`shared/resourceCatalog.json` (seed data from the table above), then
`electron/ipc/resourceResearchEngine.cjs` with `resource:catalog` and
`resource:research` (read-only, no ledger interaction — ship this first and it
is immediately useful on its own), then `resource:propose-enable` +
`KINDS.RESOURCE` applier, then the `Resources.jsx` research tab, then the
`shared/capabilities.json` entries, then wire into `main.cjs`/`preload.cjs`.

---

## SECTION 39 — StockMind AI integration: absorb the engine, not the app

> Master's ask: integrate `STOCKMIND_AI` (path `C:\CodeBase\Velvet_UI\Velvet\STOCKMIND_AI`,
> outside this workspace) into Rāma, copying what's needed and reconciling with
> Rāma's current architecture.

### What actually exists there (read via `execute_pwsh`, not file tools — the
### directory is outside the workspace root)

StockMind AI (v0.5.1) is now a full standalone app, not a small companion:

- **`server/` (Node/Express, ESM)** — 20 route files, its own three-tier
  auth (`username+Argon2id password → 12-digit key`, mirrors Rāma's own gates
  almost exactly), its own `users.js`/`superadminUnlock.js`, MongoDB-backed
  storage with field-level AES-256-GCM, a `threatShield.js` bot-trap
  middleware, Yahoo Finance market data service.
- **`ai_backend/` (Python, FastAPI on :8001)** — the actual prediction math:
  `dispatcher.py` (routes spot/futures/options requests), `features.py`
  (~80-120 engineered features across 6 buckets), `models.py` (LightGBM /
  XGBoost / LSTM-stub / RandomForest / MLP / SGD / regime / sentiment, each
  gracefully falling back to a calibrated mock when no trained artifact
  exists — `is_available()` is checked and reported, never assumed),
  `registry.py` (stacking meta-learner ensemble with online weight updates),
  `calibration.py` (Platt → isotonic → regime-adjust → hard clamp pipeline),
  `backtest.py`, `strategy_scorer.py` (10 named algorithms), `advanced_features.py`
  (Ichimoku/Fibonacci/Supertrend/Elliott/market-profile/order-flow/smart-money/
  GARCH-proxy), `data_fetcher.py` (real Yahoo Finance v8 OHLCV, no key needed,
  with a clearly-labelled deterministic mock fallback only when no data is
  available at all).
- **Also in `ai_backend/`, deliberately not absorbed** — `jarvis_core.py`,
  `jarvis_x_core.py`, `jarvis_brain.py`, `jarvis_agent.py`, `agi_engine.py`,
  `agi_envelope.py`, `friday_nexus.py`, `unified_data_hub.py`,
  `doc_intelligence.py`, `smart_theme_creator.py`, `perception_engine.py`,
  `inference_scale_quantizer.py`, `multi_horizon_wave.py`,
  `multi_level_predictor.py`, `dynamic_router.py`. These carry names like
  "Proto-ASI Conscious Core," "consciousness metric," "ToT-MAC debate," and
  formulas (`Ps`, `Calloc`, `Ptrap`, LPM) presented as governing risk in real
  time. Reading the code: they are real Python (not stubs), but the
  "consciousness"/"ASI" framing is presentation over ordinary control-flow —
  weighted averages, deques, and threshold checks, not a different kind of
  system. This is the same category of finding as Section 36/37's poster
  audits, applied to StockMind's own code this time instead of a diagram.
  They are not part of this absorption. If master wants a specific mechanism
  from them (e.g. the drawdown-based circuit breaker) evaluated on its own
  technical merits later, that is a separate, scoped ask.

### Why the whole app is not embedded (supersedes Section 7's original plan)

Section 7 (written before the three-gate auth existed) planned a webview
embed of the whole StockMind app on port 4099. Running that today would put
**two independent identity systems side by side** — StockMind's own
password+key login sitting right next to Rāma's `authCore.cjs` three-gate
login, each with its own user table, its own tiers, its own session tokens.
That's not a UI question, it's invariants I1–I5 (three gates, no identity
from Gate 1, no auth authority in the Express server, master provisioned
once, keys HMAC-only) being duplicated by a second, unrelated implementation
that Rāma's ledger has no visibility into and no ability to audit. It would
also mean maintaining MongoDB, StockMind's own rate limiter, and its own
threat-shield alongside Rāma's equivalents indefinitely.

**Decision: absorb the engine, not the app.** The prediction math in
`ai_backend/` has no auth, no user table, and no opinion about identity — it
is a pure function of `(symbol, OHLCV, capital, risk%) → signals`. That is
exactly the shape Rāma already has a slot for.

### The slot already existed

`electron/ipc/aiProcess.cjs` (built earlier, ledger rows 1–18) already:
- spawns `python -u main.py` from a sibling `ai_backend/` directory it
  resolves relative to the app path (dev, packaged, and same-root cases all
  handled),
- streams stdout/stderr to every renderer window as `ai:log`,
- exposes `ai:start-backend` / `ai:stop-backend` / `ai:get-status`,
- is already wired into `main.cjs` and `preload.cjs` (`window.rama.ai.*`).

Nothing in it was written to point at StockMind specifically — it was built
ahead of this task with an empty `ai_backend/` slot. This absorption fills
that slot rather than building a second, parallel spawn mechanism.

`shared/capabilities.json` also already has `stockmind.view` (tier 4),
`stockmind.request` (tier 3), `stockmind.config` (tier 2) defined and unused
by any handler — another piece that was placed ahead of this task.

### What is copied, and what is deliberately trimmed

Copied into `ai_backend/` at the Rāma project root:
`engine/data_fetcher.py`, `engine/features.py`, `engine/models.py`,
`engine/calibration.py`, `engine/registry.py`, `engine/dispatcher.py`,
`engine/backtest.py`, `engine/strategy_scorer.py`, `engine/advanced_features.py`,
`engine/health.py`, `engine/__init__.py`, plus a **new, trimmed** `main.py`
exposing only `/health`, `/predict`, `/backtest`, `/backtest/presets`,
`/strategy/score` — the AGI-enhancement branch in the original `/predict`
(the `agi_engine`/`jarvis_x_core` calls) is removed rather than imported and
disabled, so there is no dead import pointing at a module that was
deliberately not copied.

`requirements.txt` is pinned (I12), trimmed to what the copied engine files
actually import: `fastapi`, `uvicorn[standard]`, `pydantic`, `numpy`,
`pandas`, `scipy`, `scikit-learn`, `lightgbm`, `xgboost`, `statsmodels`,
`ta`, `httpx`, `python-dotenv`, `joblib`, `numpy-financial`. StockMind's own
`requirements.txt` uses version *ranges* "for Python 3.14 wheel
availability" — that reasoning doesn't transfer to a pinned-deps project, so
exact versions are pinned here and can be revisited if a wheel is genuinely
unavailable on the build machine.

Not copied: MongoDB, `mongoEncryption`, `authService`/`auth.js`/`users.js`/
`superadminUnlock.js`, `threatShield.js`, `predictionSigner.js`
(HMAC-signs payloads for a Node↔Python trust boundary that no longer exists
once both sides are inside Rāma's own process boundary), the whole `server/`
directory, the whole `src/` React app, and the JARVIS-X/AGI layer named above.

### How it's reached from the UI

`src/pages/StockMind/StockMind.jsx` (currently a pure stub — fake "Connect"
button with a `setTimeout`) is replaced with a real request form (symbol,
exchange, capital, risk%, direction) that calls a new
`electron/ipc/marketIntel.cjs`, gated on `stockmind.request`
(`shared/capabilities.json`, tier 3) via `capability.cjs`, which itself calls
the already-running Python backend through `lib/http.cjs` (`postJson`) —
the same unified HTTP client every other engine uses (I9), not a new fetch
implementation. `marketIntel.cjs` calls `aiProcess`'s exported status check
and starts the backend on first use if it isn't already running, rather than
requiring master to remember to press a separate "start backend" button.

The non-removable disclaimer already in `StockMind.jsx` ("AI-generated
market analysis... not financial advice... human judgment required") is kept
verbatim in the rebuilt page.

### Status

Decision and design recorded. Ledger row 52. Next concrete step on resume:
copy the 10 engine files + write the trimmed `main.py` + pinned
`requirements.txt` into `ai_backend/`, `node --check` is not applicable to
Python but a `python -c "import ast; ast.parse(open(f).read())"` syntax pass
is the equivalent floor for each copied `.py` file, then write
`electron/ipc/marketIntel.cjs`, register it in `main.cjs`, expose it in
`preload.cjs`, replace `StockMind.jsx`, then verify with the Python backend
actually started once (`window.rama.ai.startBackend()` → poll `/health`)
before marking the row done.

---

## SECTION 39 — Release channel: the dormant path from "code changed" to "installer updated"

> Master's ask: enable the auto-updater's real trigger — cutting a release —
> without a CI/CD pipeline existing yet, in a way that can become the universal
> update path later without redesigning anything. No pipeline is being wired
> up now; only the plumbing that a future pipeline plugs into.

### Why this had to be built inert

`autoUpdater` (main.cjs) already points at
`build.publish: { provider: 'github', owner: 'krishnaprasads10492', repo:
'Rama-AGI' }` and calls `checkForUpdatesAndNotify()` on every launch. What was
missing was the other end: something that actually produces a GitHub Release
for it to find. Building that as an always-on pipeline would be premature —
there is no CI/CD, no code-signing cert, and master said explicitly this is a
maybe-later capability, not a now capability. So the design goal was: **wire
the full path, but make every step require an explicit human action**, so
nothing in this section changes behaviour today.

### The three pieces

1. **`electron/lib/releaseChannel.cjs`** — version bump (patch/minor/major),
   `CHANGELOG.md` entry, commit, and an annotated git tag `vX.Y.Z`. Pushing the
   tag is a separate opt-in flag (`push: true`) — tagging locally and pushing
   are two different buttons in the UI, not one combined action. Gated by
   `release.cut` (tier 0, master-only) in `shared/capabilities.json`. Registered
   in `main.cjs`, exposed as `window.rama.release.state/cut` in `preload.cjs`.

   **This does not go through `proposals.cjs` (I6).** The ledger gates *Rāma*
   changing its own source autonomously. Cutting a release is master directly
   using a tool — the same category as `git.cjs`'s commit/push handlers, which
   also bypass the ledger for the same reason. What's gated instead is tier:
   only master can call it.

2. **`.github/workflows/release.yml`** — a GitHub Actions workflow, committed
   but **inert**: it only runs on a `v*.*.*` tag push, and even then only if
   Actions happens to be enabled for the repo (committing the file does not
   enable anything by itself). When it does run: checks out, `npm ci`, `npm run
   build` (Vite), then `electron-builder --publish always` on
   windows-latest/macos-latest/ubuntu-latest runners, using the
   auto-provided `GITHUB_TOKEN` — no new secret needed for a same-repo release.
   This produces exactly the artifact `electron-builder`'s existing `build.win/
   mac/linux` targets in `package.json` already describe (nsis+portable,
   dmg+zip, AppImage+deb) and uploads them to the GitHub Release matching the
   tag — which `autoUpdater` is already configured to poll.

3. **UI** — a `release` tab on the existing `/git` page (`GitSync.jsx`), since
   that page already owns "version control" per `registry.js` (I7) and already
   has repo-path state to reuse. Shows current version, last tag, commits since,
   and whether the dormant workflow file is present. Master-only actions:
   "Tag Locally" and "Tag & Push," each showing the honest outcome — if the
   workflow file isn't enabled on GitHub yet, the message says so instead of
   implying a build started.

### What "universal" requires later, none of it built now

Recorded so a future session (or a future master decision) has the checklist
without re-deriving it:

- **Enable Actions** on the repo (Settings → Actions → allow) — the workflow
  file alone changes nothing.
- **Code signing** — unsigned Windows builds trigger SmartScreen, unsigned
  macOS builds trigger Gatekeeper. Both still install, just with a scarier
  prompt. A cert (Windows) / Apple Developer ID + notarization (macOS) removes
  the warning; neither is configured in `electron-builder`'s config and doing
  so is a distinct, explicit step, not a side effect of this section.
- **Decide the update policy** — `autoUpdater.autoDownload = true` and
  `autoInstallOnAppQuit = true` are already set (main.cjs), meaning once a
  release is published, installed copies update themselves with no further
  action. Worth master re-confirming that's the intended behaviour once real
  releases start flowing, since today it's a no-op (no releases exist yet).
- **Decide what triggers a version bump** — right now `release:cut` is a
  manual master action from the UI. If code-level self-modification (evolution/
  self-modify/resource proposals) should eventually be able to *request* a
  release once enough changes have accumulated, that request should still land
  as a notification for master to act on via this same panel — not as an
  autonomous tag+push. Keeping I6's spirit: Rāma can say "this seems worth
  releasing," it should not decide to ship itself.

### Status

Built and inert. `node --check` clean on `releaseChannel.cjs`/`main.cjs`/
`preload.cjs`. `npm run audit` clean (71 bridge calls resolve). No tag has been
created, no workflow run has ever fired, `autoUpdater` has nothing to find yet
— all verified by inspection, not by cutting a real release (that remains
master's call). Next step if resumed cold and master wants to go live: enable
Actions on the GitHub repo, decide on code signing, then use the new Release
tab to cut `v1.0.1` as a first real test with `push:false` first to confirm the
tag/changelog look right before pushing.

---

## SECTION 40 — Local self-update: master's own CI/CD, no external pipeline

> Master's correction on Section 39: that section was scoped to a *future*,
> external CI/CD (GitHub Actions building installers for other machines).
> What's needed *now* is local — pull the latest commits on this machine using
> Rāma's own git/IDE tooling, install and build only what changed, and apply it
> to the currently running instance. No GitHub Actions, no other machines.

### Why this is a different module, not a rename of Section 39's

`releaseChannel.cjs` (Section 39) answers "how does a NEW installed copy of
Rāma, somewhere else, eventually get this change" — distribution, deliberately
inert, explicitly deferred. `localUpdateEngine.cjs` (this section) answers "how
does THIS running copy, on THIS machine, pick up commits that already exist in
its own git history" — local self-update, active as soon as master uses it.
They share the git plumbing conceptually but not the code, because conflating
"update this instance" with "cut a release for everyone" would mean either
overbuilding the local case (waiting on CI) or underbuilding the distribution
case (skipping review). Kept separate on purpose.

### Why this does not go through `proposals.cjs` (I6)

The commits being pulled already exist in git — they were written and pushed
through whatever process master already uses. This module fetches and builds
them; it does not author new source the way an evolution/self-modify/resource
proposal does. That puts it in the same category as `git.cjs`'s existing
`pull`/`checkout` handlers, which also bypass the ledger for the same reason —
I6 governs *Rāma* changing its own source autonomously, not master fetching
their own commits. What is gated is tier: `system.self-update` is tier 0
(master-only) in `shared/capabilities.json`, checked in `main.cjs` before the
engine runs.

### What it does, precisely

`electron/lib/localUpdateEngine.cjs`:

1. **`checkForUpdates(repoPath)`** — `git fetch` + status only. Read-only,
   reports branch/ahead/behind/clean and the commit list if behind. Safe to
   poll.
2. **`pullBuildApply({ repoPath, force })`**:
   - Refuses if the working tree is dirty, unless `force: true` — a pull must
     never silently discard uncommitted edits.
   - `git pull`, then diffs old HEAD → new HEAD to see which files changed.
   - Classifies each changed path into a domain using the **exact same rule**
     `start.cjs`'s live-reload watcher already uses (`classifyChange` —
     `deps`/`main`/`server`/`renderer`), copied deliberately rather than
     imported, so a file-save during dev and a git-pull in production are
     always treated identically — one rule, not two that could drift.
   - Runs `npm install` only if `package.json`/`package-lock.json` changed.
   - Runs `npm run build` only if `src/`/`shared/`/`index.html`/`vite.config.js`
     changed.
   - Returns whether a full app restart is needed (`main`/`server`/`deps`
     domains) or just a window reload (`renderer`-only) — **it never restarts
     or reloads anything itself.** `main.cjs` owns the window and app
     lifecycle; the engine reports the outcome and lets the caller (master, via
     the UI) decide when to apply it, so master sees the result before the app
     relaunches out from under them.

`main.cjs`'s `registerLocalUpdate()` adds the actual restart/reload actions,
since only the main process can safely do either:
- `update:reload-window` — `webContents.reloadIgnoringCache()`.
- `update:restart-app` — `app.relaunch()` + `app.exit(0)`, which goes through
  Electron's normal relaunch (the same `before-quit` cleanup — session lock,
  nucleus lock, IPC session clear — already wired for a manual quit runs here
  too, since it's the same event).

### UI

Two new tabs on the existing `/git` page (`GitSync.jsx`), which already owns
version control per `registry.js` (I7) and already holds `repoPath` state:

- **Update** — shows branch/behind/clean, the pending commit list, a "Pull,
  Install & Build" button (master-only, `system.self-update`), streamed
  install/build log, and — once done — an explicit "Restart App" or "Reload
  Window" button depending on what actually changed. Never auto-applies.
- **Release** — from Section 39, unchanged, still inert.

### Status

Built and functional (unlike Section 39, this is live, not dormant — pulling
and building runs for real when master clicks it). `node --check` clean on
`localUpdateEngine.cjs`/`main.cjs`/`preload.cjs`. `npm run audit` clean (76
bridge calls resolve). Not exercised end-to-end here (no second commit exists
upstream to pull in this session) — the pull/build/classify logic was verified
by code review against `start.cjs`'s existing, already-proven `classifyChange`
rule rather than by running a real pull. Next step if resumed cold: make a
trivial commit on the `dev`/`source` remotes from another clone, then use the
Update tab here to confirm a real pull → build → restart cycle end-to-end.


---

## SECTION 41 — Publish an applied self-modify proposal to its own branch

> Master's ask: the app should be able to push a change it made to itself as
> a NEW branch (not straight to `dev`/`source`), with generated release notes
> explaining what changed and why it matters, so an old version is always
> reachable to revert to.

### Where this sits relative to the ledger (I6) and to Section 39's release channel

The ledger's approve→apply gate is unchanged and runs first — `publishProposal()`
refuses anything that is not already `STATUS.APPLIED`. This section only
answers what happens to an already-approved, already-applied change on its
way toward `dev`/`source`: it lands on its own branch, not on those branches
directly, so master's merge is the point where it actually becomes "the new
version" rather than the write to disk being that point.

This is a different mechanism from Section 39's `releaseChannel.cjs` on
purpose: that module cuts a version tag for the whole project when master
decides a batch of accumulated changes is ready to ship. This one runs per
proposal, immediately after that one proposal is applied, and never touches
version numbers or CHANGELOG.md — it is about keeping each self-change
individually reviewable and revertible, not about cutting a release.

### What `electron/lib/publishProposal.cjs` does

1. Refuses anything not `STATUS.APPLIED` (I6 is enforced upstream, not
   re-checked loosely here).
2. Names a branch `self-modify/<date>-<slugified-title>-<id prefix>`.
3. Generates release notes (see below) and writes them to a **tracked**
   `release-notes/<proposalId>.md` — deliberately not under `data/`, which is
   entirely gitignored (encrypted stores, per-machine key material). Notes
   must actually be committed, so they cannot live there.
4. Creates the branch, stages the proposal's own changed files (already on
   disk from `apply()`) plus the notes file, commits, and — if `push:true`
   (the default) — pushes with `-u origin <branch>`.
5. Always checks out back to the branch the repo was on before publishing,
   success or failure, so a publish call never leaves the working tree
   sitting on the new branch.

Verified against a disposable scratch git repo (not this project's real
repo): after publish, `dev` still contained only its original file, the new
branch contained the proposal's file plus the notes file, and the working
tree matched `dev` exactly having returned there automatically.

### Release notes — a laddered capability (Section 30's pattern), not an LLM dependency

- **L0 (always available, no network/credential needed):** assembled directly
  from the proposal record — kind, title, summary, changed files, risk,
  requires-restart, and the AST-based verification summary/issues from
  `verifyProposal.cjs` if it ran. This alone is what "explanation and
  significance" means when no model is configured.
- **L1 (used opportunistically):** the same structured facts are handed to
  whatever model `modelRouter.cjs` can currently reach (`selectModel` +
  `checkAvailable`), asked to explain the change and its significance in
  plain language. Any failure — no model configured, no credential, a failed
  call — silently falls back to L0 rather than blocking the push. The AI
  explanation is appended after the structured facts, not instead of them, so
  the concrete file list and risk/verification data are never only as
  reliable as an LLM call.

### Why master-triggered, not autonomous — same reasoning as Section 39's tags

`publish:proposal` is gated on `release.cut` (tier 0), the same capability
that gates cutting a version release. Pushing requires a live git credential
on whatever machine is running Rāma; letting the app push on its own after an
unattended self-modify would mean a compromised or buggy instance could push
under master's identity with no one in the loop. The invariant already
written for releases applies unchanged here: Rāma can say a change is ready
to publish, it should not decide to ship itself. `push:false` is available
for the same "commit locally, review before it leaves this machine" step
`releaseChannel.cjs` already offers for tags.

### UI

`ProposalCard` in `Evolution.jsx` gained a "⎇ Publish branch" action, shown
only once a proposal's status is `applied`. It calls
`window.rama.publish.proposal({ user, repoPath, proposalId })` and displays
the resulting branch/commit outcome plus a collapsible view of the generated
release notes.

### Status

Built and verified end-to-end against a disposable scratch repo (branch
creation, commit, notes file, and return-to-starting-branch all confirmed;
push was not exercised against a real remote in this session — `push:false`
path was used for the scratch test). `node --check` clean on
`publishProposal.cjs`, `main.cjs`, `preload.cjs`. `npm run audit` clean (78
bridge calls resolve, up from 77 — the new `publish.*` surface). Not yet
wired into any proposal kind besides being callable for all of them
(SELF_MODIFY, EVOLUTION, REGEN, GENOME, RESOURCE) uniformly, since the ledger
already treats every kind the same way at the apply boundary. Next step if
resumed cold: exercise `push:true` against a real fork/test remote once one
is available, and consider whether `RemoteEngine` proposals from
`resourceResearchEngine.cjs` should surface the same "Publish branch" action
in `Resources.jsx`'s research tab (currently only wired into `Evolution.jsx`).


---

## SECTION 42 — Any OpenAI-compatible LLM provider, current or future, without a code change

> Master's ask: Rāma should be able to include ALL kinds of LLM models to
> enhance all kinds of functions available now and in the future — an
> upgrade path, not a fixed list — WITHOUT COMPROMISING SECURITY AND DATA
> EVEN IF ADVANCED AI MIGHT TRY TO DO IT.

### Why "OpenAI-compatible" genuinely covers "all kinds," and what it doesn't

`/v1/chat/completions` with a `{model, messages}` request and a
`choices[0].message.content` response is the de facto standard almost every
LLM host now speaks — `modelRouter.cjs`'s own `groqChat`/`mistralChat`
already use exactly this shape for two "different" providers. One generic
adapter (`customChat()`) therefore covers OpenRouter, Together, Fireworks,
DeepSeek, Perplexity, and local llama.cpp/vLLM/LM Studio servers, plus most
providers that appear after this was written — a real, open-ended "future
models" path, not a fixed list re-typed as a promise.

**Disclosed limit, not glossed over**: a provider with a genuinely different
API shape (Anthropic's own format, Gemini's) still needs its own adapter
function, the same as `anthropicChat`/`geminiChat` today. "All kinds" is
true for the overwhelming majority of the market, not literally every API
shape that could ever exist.

### The security boundary — structural, not a behavioural promise

Master's phrasing ("even if advanced AI might try to do it") was taken as: do
not rely on a model behaving itself — make the unsafe path not exist.

1. **No agent-callable path.** `customProviders.cjs`'s `add()`/`remove()` are
   reached only via `models:add-custom-provider`/`models:remove-custom-provider`
   IPC handlers, called from `Models.jsx`'s UI form. `agentOrchestrator.cjs`'s
   `parseActions`/`executeAction` — the only place a model's own text output
   is ever parsed as an instruction — has a closed, hardcoded switch
   (`search`/`read`, default `not auto-executable`). Verified by grep: no
   reference to either handler name anywhere in `agentOrchestrator.cjs`.
2. **Same tier gate as adding any provider's API key.** Both handlers require
   `models.add-key` (tier 1, master/superadmin only) — adding a custom
   provider is not a lower-privilege action than adding an OpenAI key.
3. **Credentials never leave the vault.** The non-secret record (name,
   base URL, model list, credential-key NAME) lives in `dataStore.cjs`'s
   `config` domain (encrypted at rest); the secret itself goes through
   `credentialVault.cjs`'s existing AES-256-GCM store under a generated
   `credKey`. `add()` rolls back its own record if the vault write fails,
   so a provider entry can never reference a credential that doesn't exist.
4. **No SSRF into this machine's own services.** `validateBaseUrl()` refuses
   loopback/private/link-local hosts (including the `169.254.169.254`
   cloud-metadata pattern) unless master explicitly passes `allowLocal:true`
   — verified against 8 cases (public HTTPS accepted, localhost/127.0.0.1/
   169.254.169.254/malformed/wrong-protocol all rejected, LAN IP accepted
   only with `allowLocal`). Without this, a "provider" entry could otherwise
   be used to quietly redirect Rāma's own calls at its own unauthenticated
   Express API (`localhost:4097`, invariant I2) or other local services.
5. **No self-modification path.** Registering a provider changes runtime
   state and one encrypted domain record only — no `changes[]`, no file
   write, no `proposals.cjs` entry anywhere in `customProviders.cjs`. It
   cannot be used as a route around invariant I6.
6. **Honest failure.** An unreachable or non-compliant custom endpoint fails
   the same way any provider call fails elsewhere in `modelRouter.cjs` — the
   fallback chain moves on; nothing is assumed to have worked.

### How it plugs into the existing router, with zero special-casing

`customProviders.toRegistryEntries()` projects every stored custom provider
into `MODEL_REGISTRY`'s exact shape (`refreshCustomProviders()`, called at
`models:list` and `selectModel` time, mutates `MODEL_REGISTRY` in place so
`resourceOrchestrator.cjs`'s direct reference to the same object object stays
in sync). From that point on, a custom model is just another registry entry
— the existing fallback chain, capability caps, and rate-limit accounting
in `modelRouter.cjs`/`resourceOrchestrator.cjs` apply to it with no new
branching logic anywhere else in the codebase.

### Status

Built and verified. `node --check` clean on all five touched `.cjs` files.
`validateBaseUrl()` verified against 8 cases (public/local/malformed/
wrong-protocol). `add()`/`list()`/`remove()` verified end-to-end against a
mocked dataStore+vault (not the real encrypted store): secret correctly
lands only in the vault mock, never in the plain record; localhost correctly
refused without `allowLocal`; `toRegistryEntries()` output matches
`MODEL_REGISTRY`'s shape; remove cleans up both the record and the vault
entry. `npm run audit` clean (81 bridge calls resolve, up from 78). UI: new
"Custom" tab on `Models.jsx` with an add-provider form and a list with
remove. Not yet exercised against a real custom endpoint (no test API key
available in this session) — the generic adapter's request/response
handling was verified by code review against the already-proven
`groqChat`/`mistralChat` shape it mirrors, not by a live call.


---

## SECTION 43 — Metrics stopped reflecting reality; Rāma's own resource footprint

> Master's observation running on another PC: resource status/PC params were
> not reflecting properly. Also asked for the total system metrics to be
> shown alongside what's due to Rāma running in foreground and background.

### Root cause

`systeminformation` on Windows shells out to a fresh `powershell.exe` per
call unless a persistent session is kept open via `si.powerShellStart()`.
Measured directly on a real machine: 2-13 seconds per cold call
(`osInfo`/`graphics`/`battery`/`cpuTemperature`/`fsStats`/`networkStats`),
150ms-2s once a session is warm. `sysinfo.cjs` never called
`powerShellStart()`. `system.cjs`'s `get-metrics` fires 8 such calls; both
the (unused) streaming handler and `System.jsx`'s actual 5s poll used a
fixed `setInterval`/`setTimeout` that fires the next call on schedule
regardless of whether the previous one has returned. On a machine where a
call takes longer than the poll interval, calls pile up and results arrive
stale and out of order — that is what "not reflecting properly" was.

### Fix

- `sysinfo.cjs` starts the persistent PowerShell session at load
  (Windows only), released via new `shutdown()` from `main.cjs`'s
  `before-quit`.
- Both polling loops are now self-paced: schedule the next call only after
  the current one resolves. Verified: cannot get more than one sample behind
  reality regardless of how slow a given call is.

### Rāma's own footprint, separate from total system load

New `system:get-own-footprint`: `app.getAppMetrics()` (Electron's own
accounting for main/renderer/GPU/utility processes — real per-process
CPU%/memory) combined with Rāma's external child processes Electron doesn't
see — the Python prediction backend (`aiProcess.cjs`), open terminal PTYs
(`terminal.cjs`), the Playwright browser (`browserEngine.cjs`) — looked up
by PID in the live `systeminformation` process list. A PID that has already
exited reports "not found" rather than being silently dropped or estimated.
New "Rāma's own footprint" panel on the System page, broken down by process
type, next to the machine-wide gauges.

### Status

Verified end-to-end: `system:get-own-footprint` invoked directly inside a
real Electron process (not the renderer round-trip) — confirmed real
per-process CPU/memory for the main process, graceful empty result when no
external child process is running. `sysinfo.cjs`'s persistent-session
speedup measured directly (multi-second cold calls → 150ms-2s warm).
`node --check` clean on all 6 touched `.cjs`. `npm run audit` clean (81
bridge calls — `getOwnFootprint` goes through `systemClient`, not the
`window.rama.*` surface the audit tracks). Not tested on the specific other
machine that reported the original symptom — the fix addresses the
mechanism (spawn cost + fixed-interval polling), not that machine directly.

---

## SECTION 44 — App assimilation: built, but not reachable from the running app

> Master asked whether "already-installed OS apps assimilated into
> capability when run" is a capability ingrained in Rāma.

### What exists

`electron/ipc/appAssimilation.cjs` is real, complete backend code: scans
installed apps (Windows registry / macOS `/Applications` / Linux
`.desktop` files), assigns a capability tier per app (`full-control` for
apps with known automation surfaces — Office via COM, Chrome/Edge via CDP;
`spawn-only` for CLI-capable apps; `data-only` otherwise), and can
launch/query/spawn-cli against a scanned app with an audit log. It is
registered in `main.cjs` (`appsIPC.register(ipcMain)`) and exposed in
`preload.cjs` as `window.rama.apps.*`.

### What's missing — this is not reachable today

1. **No capability gate.** `capabilities.json` defines `apps.view` (tier 2),
   `apps.execute-safe` (tier 2), `apps.execute-all` (tier 0), but nothing in
   `appAssimilation.cjs` calls `capability.can()` — every handler is
   currently open to any caller regardless of tier.
2. **No UI.** No page in `src/config/registry.js` references it, and no
   `.jsx` file calls any `window.rama.apps.*` method. The engine has no
   front door — a user cannot reach it from the running app.

So: real, working capability, currently dead code from the user's
perspective, and unguarded if something did call it directly. Wiring the
capability gate is the immediate fix regardless of whether/when a UI is
built; a UI is a separate, larger follow-up (a page showing the scanned
registry, per-app tier, and a launch/query action gated the same way).

### Status

Documented, not yet fixed. Next step: add `capability.can()` gates to
`appAssimilation.cjs`'s handlers (`apps.view` for scan/registry/audit reads,
`apps.execute-safe` for `launch`/`query`, `apps.execute-all` for
`spawn-cli`), matching the tiers already defined. UI is a separate,
explicitly deferred follow-up.
---

## SECTION 45 — Build anywhere from source: a self-preparing packaging pipeline

> Master's report: option 2 of `Rama.bat` ("Build Windows installer") does not
> produce a build. Master's requirement: *"I should be able to generate build
> anywhere if I have source code"* — on a personal machine it should check
> whether the dependencies/modules exist, install them if they do not, and then
> create the build.

### What was actually wrong — two separate faults, only one of them a dependency

**Fault 1 — the corporate machine blocks the archiver, not a dependency.**
The failure on the work machine is not missing modules. It is BeyondTrust
Privilege Management (Accenture endpoint policy) refusing to start
`node_modules/7zip-bin/win/x64/7za.exe` — reported as *"Vulnerable Application
Version Detected · 7-Zip Standalone Console · 21.07"*. Measured on this machine:

- `7zip-bin@5.2.0` ships 7-Zip **21.07**, which is what the policy flags.
- Executing that binary directly yields *"failed to run: No process is
  associated with this object"* — the process is never created. Not a bad exit
  code, not a missing file: blocked at `CreateProcess`.
- No system 7-Zip is installed (`C:\Program Files\7-Zip\7z.exe` absent, nothing
  named `7z`/`7za` on `PATH`).
- `vite build` on the other hand **succeeds** here (88 modules, `build/` written).
  So the renderer half of `build:win` was never the problem.

Where electron-builder needs that binary, confirmed by reading the installed
`electron-builder@24.13.3` rather than assuming:

| Consumer | File | Needs 7za? |
|---|---|---|
| NSIS installer payload (`app.7z`) | `app-builder-lib/out/targets/archive.js:48` | yes |
| NSIS archive inspection (`7za l`) | `app-builder-lib/out/targets/nsis/NsisTarget.js:217` | yes |
| `portable`, `zip`, `7z` targets | `archive.js:173` | yes |
| every `app-builder.exe` invocation (`SZA_PATH`) | `builder-util/out/util.js:336` | passes it through |
| unpacking `winCodeSign-2.6.0.7z` for sign/edit-executable | cache fetch during `--dir` | **yes** |
| packing the app tree itself (`--dir`) | — | no |

**The fourth row was found by running it, not by reading it, and it contradicts
what this section first claimed.** Reading the source suggested `--dir` needed no
archiver. In practice `--dir` packs the tree, passes `afterPack`, and then
downloads `winCodeSign-2.6.0.7z` and extracts it *with 7za* for the
sign/edit-executable step — with no certificate configured — failing four times
on retry and taking the whole build with it. So the fallback rung additionally
passes `-c.win.signAndEditExecutable=false`, which removes that step and with it
the last 7za dependency on the unpacked path. The cost is stated rather than
hidden: `rcedit` is part of the skipped step, so the launcher `.exe` keeps
Electron's default icon and version metadata. The application inside is complete.

### Starting a blocked binary kills the caller, not the child

The blocked `7za.exe` does not fail politely. Measured directly:

```
node -e "spawnSync('node_modules/7zip-bin/win/x64/7za.exe', ['i'])"
  → AssignProcessToJobObject: (6) The handle is invalid.
  → node exits 0xC0000003; the line after the spawn call never runs
```

`spawnSync` does not return an error object — **the calling process is
terminated**. The first version of the archiver probe was therefore unfixable by
any amount of error handling in this file: the pipeline died mid-stage-3 with no
report, which is exactly the symptom that made the original failure look
mysterious.

**Decision:** the probe runs in a throwaway child `node` process, with the
candidate path passed by environment variable so there is no argv or quoting
ambiguity. A probe that does not survive is itself the evidence — a merely
missing or corrupt file returns a normal spawn error instead, so "the probe
died" reliably distinguishes a policy block from a broken file.

### The verdict is remembered, because probing costs the master a dialog

Probing means *starting* the binary, and each attempt raises a BeyondTrust
dialog that the master has to dismiss. The answer only changes when the binary
changes.

**Decision:** verdicts are cached in `data/system/archiver-probe.json`, keyed by
absolute path and fingerprinted by size + mtime, next to `start.cjs`'s scenario
memory and for the same reason. A remembered block is reported as remembered and
the binary is not started again. `--recheck-archiver` forces a re-test. Because
the fingerprint changes when the file does, staging a replacement over
`7zip-bin`'s path re-probes automatically without any cache invalidation logic.
`data/` is gitignored, so the memo stays machine-local — which is correct, since
the verdict is a property of the machine's policy, not of the source.

**Fault 2 — the build path assumed a prepared machine.**
`Rama.bat` option 2 called `npm run build:win` directly, which is
`vite build && electron-builder --win --x64`. On a fresh clone with no
`node_modules`, `vite` does not exist and the first command dies with a bare
"'vite' is not recognized", which reads exactly like the "dependency issue"
master described. `start.cjs` already knows how to diagnose and install — but
nothing on the *packaging* path used it. Option 1 self-heals; option 2 did not.

### Decision: `scripts/buildInstaller.cjs`, a staged packaging pipeline

Same shape as `start.cjs` (stages, glyph vocabulary, scenario-free but
diagnose-then-act), because packaging deserves the same self-healing that
booting already has. `npm run build:win` is **kept unchanged** as the raw
escape hatch (I11 — additive, never remove a capability); the batch file now
routes through the new script.

**Stage 0 — Toolchain.** Node ≥ 18, npm on `PATH`, project root sanity
(`package.json` is really `rama-agi`), free disk. Packaging Electron needs room
for the unpacked tree plus the installer, so under 3000 MB is a warning and
under 1200 MB is fatal — failing here is far kinder than failing at 90%.

**Stage 1 — Dependencies.** The expected set is **derived from
`package.json`** (`dependencies` + `devDependencies`), not hardcoded, so the
check cannot drift as the manifest changes. Because every version is pinned
exact (I12), the check is presence **and exact version equality**:
`node_modules/<name>/package.json`'s `version` must equal the spec. That also
catches a stale `node_modules` left over from an older manifest, which a bare
existence check misses.

`argon2` and `node-pty` are classified **tolerated**: they are native, they may
fail to compile without Visual Studio Build Tools, and both already have working
fallbacks (scrypt; piped shell). A broken native binding degrades the build, it
does not stop it.

For those two, `require()` succeeding is **not** accepted as evidence. The first
version of this check reported "node-pty native binding loads" while
`node_modules/node-pty/build` contained no `.node` file whatsoever — node-pty
resolves its addon lazily at terminal-construction time, so importing it proves
nothing. A build on that evidence packages a module that cannot work, and the
failure surfaces on the master's machine as a dead terminal instead of here as a
warning. The check therefore looks for a **compiled binary this platform could
load**: any `.node` outside a `prebuilds/` tree (compiled here, for here), or one
inside `prebuilds/` whose path matches `<platform>-<arch>`. Measured on the work
machine: `argon2` passes on `prebuilds/win32-x64/argon2.glibc.node` (Node-API, so
ABI-stable under Electron with no rebuild), `node-pty` correctly fails.

Install ladder, each rung tried only if the previous failed:

1. `npm ci` — only when `package-lock.json` exists *and* `node_modules` is
   absent. Lockfile-exact and clean, which is what pinned versions want.
2. `npm install --no-audit --no-fund`.
3. `npm install --no-audit --no-fund --legacy-peer-deps`.
4. `npm install --no-audit --no-fund --ignore-scripts` — last resort. Skips
   native compilation, so the app runs on its fallbacks; recorded as degraded
   and reported, never silently.

After installing, the check is **re-run**. If a required package is still
missing the pipeline stops and prints the exact list. A half-installed installer
is worse than no installer, because it fails on the master's machine instead of
on the build machine.

**Stage 2 — Renderer.** `vite build` always runs, never conditionally on
staleness. Staleness heuristics are right for `start.cjs`, where the cost of a
rebuild is felt on every launch; for a release artefact the only acceptable
input is a bundle built from the current source (ledger row 43 is the record of
what a stale bundle costs).

**Stage 3 — Archiver.** A capability ladder, the same pattern as the voice
ladder (row 38) and for the same reason: presence on disk is not capability.
Each rung is **executed** and must identify itself as 7-Zip in its own output —
a name match alone proved insufficient once already, when Whisper detection
matched `C:\Windows\System32\main.cpl`.

- **L0 bundled** — `7zip-bin`'s own binary. Normal case, nothing to do.
- **L1 system** — search `%ProgramFiles%`, `%ProgramFiles(x86)%`,
  `%LOCALAPPDATA%\Programs`, the `HKLM\SOFTWARE\7-Zip` registry `Path` value,
  and `PATH`, preferring self-contained `7za.exe`, then `7z.exe` (copied
  together with its `7z.dll`, which it cannot run without), then `7zr.exe`
  (`.7z`-only, which is all NSIS actually needs). The winner is staged **over**
  `node_modules/7zip-bin/win/<arch>/7za.exe`, with the original preserved once
  as `7za.exe.bundled`.

  Why overwrite the module file rather than use the documented
  `USE_SYSTEM_7ZA=true`: that flag makes `7zip-bin` return the bare string
  `"7za"`, and `builder-util/out/7za.js:7` then calls
  `chmod("7za", 0o755)` on it before use. On Windows that resolves against the
  CWD, finds no file literally named `7za`, and throws `ENOENT` — the flag is
  unusable here. `7zip-bin`'s resolved path is the one interception point every
  consumer shares, including the `SZA_PATH` handed to `app-builder.exe`.
  The swap is idempotent and reversible.

- **L2 none** — installers are impossible, so build what is still possible:
  `electron-builder --dir` (no 7za on that path, per the table above) and then
  zip `win-unpacked` with **.NET's** `ZipFile.CreateFromDirectory` via
  PowerShell on Windows, `zip -r`/`tar` elsewhere. No external archiver, so
  policy has nothing to block. The result is a genuine portable distributable —
  unzip, run `Rama AGI.exe` — and it is labelled as exactly that, not as an
  installer.

**Stage 4 — Package.** `electron-builder` is invoked directly with the resolved
target set, not through `npm run build:win`, so the renderer is not built twice.

**Stage 5 — Report.** Lists what landed in `dist-electron/` with real sizes,
states which archiver rung was used, and names anything degraded. On the work
machine the honest output is "portable zip produced, NSIS installer blocked by
endpoint policy" — a true partial result beats a green tick that is a lie.

### Every run writes a transcript

Packaging happens on a machine that is not the one with the editor open, so a
failure arrives as "the build failed" with none of the output that says why. That
made the first report of a failure on the master's personal machine impossible to
act on: there was nothing to read.

**Decision:** every run writes `data/logs/build-<timestamp>.log` containing the
stage report *and* the full output of every command it invokes, with ANSI escapes
stripped, so it can be sent as a file. This needed a real change of mechanism:
`execSync` with `stdio:'inherit'` shows output but keeps no copy, while
`spawnSync` with piped stdio keeps a copy but shows nothing until the command
exits — unacceptable for a ten-minute `npm install`. Commands now run through an
async `spawn` that tees each chunk to both the terminal and the log, which is why
the pipeline is async throughout.

On failure the last twelve lines of the failing command are also reprinted in the
report, so the cause is visible without opening the log at all. `data/` is
gitignored, so transcripts stay local.

### The salvage path was reporting the wrong cause

The master sent a photo of the run on their personal machine. It shows the build
*succeeding* into a 129.7 MB portable zip via the salvage path, with
`electron-builder failed after packing the app tree` — and then the report
claiming `Archiver none available` and advising the master to install 7-Zip.

That advice was wrong on that machine. 7-Zip there works; the app tree packed
cleanly; electron-builder failed afterwards, building the installer targets. The
bug was in `main()`: the salvage branch overwrote the archiver verdict with
`{ level: 2 }` before handing it to `report()`, which is how a machine with a
perfectly good archiver was told its archiver was missing. A report that
misattributes a cause is worse than no report, because it sends the master
chasing a problem that does not exist.

**Decision:** the archiver verdict is passed through untouched, and the salvage
case is its own reported state (`salvaged`) rather than being folded into "no
archiver available". It now names the working archiver, says the installer step
is what failed, prints the failing command's last twelve lines **at the end of
the run** — the part that fits in a screenshot — and offers no 7-Zip advice.
Verified against a patched throwaway copy with a faked archiver verdict, so
nothing had to start the blocked binary to test it.

### What the NSIS step actually had wrong

The installer step had never executed anywhere: this machine cannot reach it, so
`assets/installer.nsh` had never been compiled by `makensis` even once. Two real
defects were sitting in it, both found by inspection against the installed
electron-builder:

1. **Undefined symbols.** It referenced `productName` and `version` in NSIS
   `${...}` form. Those are electron-builder *artifactName* placeholders, not
   NSIS defines. What electron-builder actually defines is `PRODUCT_NAME`,
   `PRODUCT_FILENAME` and `VERSION` (`Defines.js:154-158`). NSIS leaves an
   unknown symbol unexpanded with a warning, so the installer would have
   registered the `rama://` handler as a literal `${productName}.exe` — a path
   that does not exist. Deep links would have silently failed after a successful
   install. Now `${PRODUCT_FILENAME}` and `${VERSION}`.
2. **Non-ASCII without a BOM.** The file was UTF-8 with no BOM and 475
   non-ASCII bytes (box-drawing rules, and "Rāma" with its macron). NSIS reads an
   included script in the system codepage unless a BOM says otherwise, so those
   bytes were being mangled at compile time. Rewritten ASCII-only, with the
   constraint documented in the file itself so it is not reintroduced. Accented
   display text belongs in `package.json`, which electron-builder encodes
   properly.

Also confirmed *not* a problem, to save the next session the search:
`MUI_WELCOMEPAGE_TITLE`/`_TEXT` do not collide with anything — electron-builder's
NSIS templates never reference `MUI_WELCOMEPAGE`, so redefinition (a hard NSIS
error) cannot occur. They are simply inert, since the assisted installer inserts
no welcome page; that is now stated in the file rather than implied.

**Neither defect is confirmed to be the failure the master hit.** Both are real
and both live in exactly the step that failed, but an unexpanded symbol is a
warning and mangled bytes inside string literals may also only warn. The
transcript from that machine is still the thing that will say.

### The actual cause: a symlink privilege, not the archiver and not the source

With the transcript fix in place, the master's next run named it outright:

```
Archiver        bundled 7-Zip 21.07
Installer       attempted and failed - salvaged as portable

Why electron-builder failed (last lines):
  ERROR: Cannot create symbolic link : A required privilege is not held by the
  client. : ...\Cache\winCodeSign\399771727\darwin\10.12\lib\libcrypto.dylib
  command=...\7zip-bin\win\x64\7za.exe x -bd ...\winCodeSign\399771727.7z
```

electron-builder fetches its `winCodeSign` bundle during the Windows installer
targets. That archive carries **macOS** symlinks (`darwin/10.12/lib/*.dylib`).
Creating a symlink on Windows requires `SeCreateSymbolicLinkPrivilege`, which a
standard account does not hold unless Developer Mode is on — so 7-Zip fails four
times over and the installer build dies. It dies *after* the app tree is packed,
which is precisely why it looked like a packaging or archiver problem for three
rounds of diagnosis.

Nothing in Rāma's source causes this, and nothing in Rāma's source can grant a
Windows privilege. What it can do is stop being surprised by it:

1. **Predict it.** Stage 0 now creates a symlink in a temp directory and deletes
   it. If that fails, the report says up front that the installer step will fail,
   and gives the two real fixes: Developer Mode, or an elevated terminal. The
   probe reproduces the failure on the work machine (`EPERM`), so the detection
   is verified on the same condition it is meant to catch.
2. **Work around it without losing the installer.** The only reason winCodeSign
   is fetched at all is the sign/edit-executable step. A new rung sits between
   "installer" and "give up": on a failure matching the symlink signature, the
   installer is retried with `-c.win.signAndEditExecutable=false`, which skips
   that step entirely. That yields a **real, working NSIS installer**; the cost
   is that `rcedit` is part of the skipped step, so the launcher `.exe` keeps
   Electron's default icon and version metadata. Reported explicitly, never
   quietly. Dropping to a portable archive is now the third rung, not the second.
3. **Name it on failure.** The classifier matches the master's exact error text
   and not unrelated NSIS errors (verified both ways), and prints the Developer
   Mode remedy rather than generic advice.

Worth stating plainly: the sequence "wrong report → misattributed cause → three
rounds" was caused by a reporting bug of mine, not by the environment. The
transcript and the salvage-state fix are what made the real cause visible in a
single run.

### The NSIS include is now checked before anything is built

`assets/installer.nsh` had shipped two defects for its whole life because
`makensis` never ran anywhere (see above). Fixing them once is not enough — the
same class recurs the moment someone edits the file on a machine that cannot
compile it. Stage 0 therefore validates it statically, before the ten minutes of
installing and building:

- **Encoding.** Non-ASCII bytes with no BOM are flagged, since NSIS reads an
  included script in the system codepage otherwise.
- **Symbols.** Every `${X}` where `X` is not `UPPER_SNAKE_CASE` is flagged.
  electron-builder's NSIS defines are all upper case; lower-case spellings are
  `artifactName` placeholders that NSIS leaves as literal text. Comment lines are
  stripped first, so the file's own explanation of the mistake is not flagged.
- **Macro balance.** Unequal `!macro` / `!macroend` counts, which `makensis`
  always rejects.

These warn rather than block: none is provably fatal, and a portable build is
still worth producing. Verified behaviourally against a deliberately broken copy
— 107 non-ASCII bytes, `${productName}`, `${version}`, and one unclosed macro all
flagged; the repaired file passes.

### Verified, and not verified

Verified by running it on the work machine — the hostile case:

- Stages 0–1: 30 pinned packages checked, `argon2` accepted on its win32-x64
  prebuild, `node-pty` correctly reported as not compiled and degraded.
- Stage 3: the block is detected without killing the pipeline, and on the second
  run onward it is recalled from the memo with **no policy dialog raised**.
- Stages 2, 4, 5 end to end: `vite build` → `electron-builder --dir
  -c.win.signAndEditExecutable=false` → 114.5 MB
  `Rama-AGI-1.0.0-win-unpacked-portable.zip`, exit code 0. Archive inspected:
  604 entries including `Rama AGI.exe` and `resources/app.asar` (13.3 MB).

**Not verified here, and it cannot be:** the L0 and L1 rungs, the NSIS and
portable-exe targets, and therefore the whole `--dir`-free path. This machine has
no runnable 7-Zip of any version, so every installer path is unreachable on it by
construction. The master reported that
electron-builder failed on their personal machine, and that run predates the
transcript, so the cause is not yet known — see the ledger row for the open next
step rather than a guess recorded here as fact.

### What this does and does not fix

- On a personal machine with source only: bare clone → `Rama.bat` → 2 →
  installs, builds, packages. This is the requirement master asked for.
- On the Accenture machine: the dependency half is fixed, and the archiver half
  is worked around as far as an unprivileged process can go — a real portable
  distributable is produced, and the policy dialog is raised at most once ever.
  The NSIS and portable-exe targets stay blocked until a current 7-Zip is
  installed machine-wide (which L1 then picks up with no further changes) or the
  path is allow-listed. Rāma does not try to defeat an endpoint control; it names
  it, remembers it, and delivers the artefact it can still produce.

