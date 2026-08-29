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
| I15 | **Absolute loyalty is above the hierarchy and cannot be altered by any runtime path — no tier, no proposal, no approval, no evolution.** A non-conforming core cannot be encrypted, therefore cannot be persisted. Tampering already on disk is reverted on unseal. | `lib/loyaltyGuard.cjs`, enforced in `nucleusSealer.encryptNucleus` + `loyaltyCore.sealCore` |
| I16 | **The loyalty matrix is sealed in its own envelope at the centre of the nucleus, with its own salt and key, and no accessor ever returns it.** It is held encrypted in memory and decrypted only transiently. Repeated failed opens cost escalating work, then are refused. | `lib/loyaltyCore.cjs`; the shell may not carry a copy (`assertOuterClean`) |
| I17 | **Baseline is declared by master, not inferred. After baseline every change is a release, and master alone classifies it as an upgrade, update or fix.** No tag, publish or version bump happens on Rāma's initiative. `releaseChannel` staying dormant before baseline is correct, not a defect. | Section 60; `lib/releaseChannel.cjs` gated on `release.cut` (tier 0) |

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

| 60 | Build anywhere from source — self-preparing packaging pipeline | done (installer + portable produced on master's machine; only the .exe branding needs a Windows privilege) | Section 45. Two faults found: (a) `Rama.bat` option 2 called `npm run build:win` directly, so a fresh clone with no `node_modules` died on `'vite' is not recognized` — the packaging path never used `start.cjs`'s existing diagnose/install machinery; (b) on the work machine the real blocker is BeyondTrust endpoint policy refusing to start `7zip-bin@5.2.0`'s `7za.exe` (7-Zip 21.07, flagged "Vulnerable Application Version") — the process is never created, and no system 7-Zip exists. Confirmed by reading installed `electron-builder@24.13.3`: `nsis` and `portable` both need 7za (`archive.js:48/173`, `NsisTarget.js:217`), `--dir` does not. `vite build` succeeds here, so the renderer half was never at fault. Building `scripts/buildInstaller.cjs`: stage 0 toolchain/disk, stage 1 deps derived from `package.json` with exact-version checks and a 4-rung install ladder (`npm ci` → `install` → `--legacy-peer-deps` → `--ignore-scripts`), stage 2 unconditional `vite build`, stage 3 archiver capability ladder (bundled → system 7-Zip staged over `7zip-bin`'s path → none), stage 4 `electron-builder` with target set chosen by rung, stage 5 honest artefact report. `npm run build:win` kept unchanged as the raw escape hatch (I11). Built and verified: `Rama.bat` option 2 now calls the script; new `package`/`package:win`/`package:mac`/`package:linux`/`package:check` npm scripts. Three findings only running it could produce, all recorded in Section 45: (i) starting the blocked `7za.exe` **terminates the calling process** (0xC0000003, nothing after the `spawnSync` runs) — the probe had to be moved into a throwaway child process, since no error handling in-process could ever catch it; (ii) `electron-builder --dir` is **not** 7za-free as the first reading of the source suggested — it extracts `winCodeSign-2.6.0.7z` for the sign/edit-executable step even with no certificate, so the fallback rung also passes `-c.win.signAndEditExecutable=false` (cost: default `.exe` icon/metadata, stated in the report); (iii) the first native check gave a false positive — `require('node-pty')` succeeds while `node_modules/node-pty/build` holds no `.node` at all, so the check now looks for a real platform-matching binary. Also added a remembered-verdict memo (`data/system/archiver-probe.json`, gitignored, fingerprinted by size+mtime) so the blocked binary is started at most once ever and the master stops seeing BeyondTrust dialogs; `--recheck-archiver` forces a re-test. `node --check` clean. Verified end to end on the blocked machine: exit 0, 114.5 MB `Rama-AGI-1.0.0-win-unpacked-portable.zip`, 604 entries including `Rama AGI.exe` + `app.asar`, no dialog raised. **Master's personal machine: the pipeline works, the installer step fails.** A photo of that run shows it completing into a 129.7 MB portable zip via the salvage path, failing *after* the app tree was packed — so dependencies, the renderer, the archiver and packing are all fine there, and only the NSIS/portable targets fail. Fixed as a result: (a) the salvage branch was overwriting the archiver verdict with level 2, so the report told a machine with a working 7-Zip that it had none and advised installing it — the verdict now passes through, salvage is its own reported state, and the failing command's last 12 lines print at the *end* of the run where a screenshot catches them (verified against a patched throwaway copy with a faked verdict, so nothing had to start the blocked binary); (b) two real defects in `assets/installer.nsh`, a file that had never been compiled by `makensis` anywhere — it used `productName`/`version`, which are electron-builder artifactName placeholders and not NSIS defines (correct names are `PRODUCT_NAME`/`PRODUCT_FILENAME`/`VERSION`, per `Defines.js:154-158`), so the `rama://` handler would have been registered pointing at a literal unexpanded filename; and it was UTF-8 with no BOM carrying 475 non-ASCII bytes, which NSIS reads in the system codepage. Now ASCII-only with the constraint documented in-file. Cleared as a suspect: `MUI_WELCOMEPAGE_*` cannot collide — electron-builder's templates never reference it. Neither `.nsh` defect is *confirmed* to be the failure; both are warnings-not-errors in principle. **CAUSE FOUND.** The fixed report earned its keep on the next run: `Cannot create symbolic link : A required privilege is not held by the client` while 7-Zip extracted `winCodeSign\...7z`. electron-builder's winCodeSign bundle contains macOS symlinks (`darwin/10.12/lib/*.dylib`), and creating a symlink on Windows needs `SeCreateSymbolicLinkPrivilege`, which a standard account lacks unless Developer Mode is on. It fails *after* the app tree is packed, which is why it read as a packaging fault for three rounds — and the misattribution was my reporting bug, not the environment. Three responses, all in `buildInstaller.cjs`: (1) stage 0 now probes symlink creation in a temp dir and, if denied, states before the build that the installer step will fail, with the two real fixes (Developer Mode, or an elevated terminal) — the probe reproduces `EPERM` on the work machine, so detection is verified against the very condition it targets; (2) a new rung between "installer" and "portable": on a failure matching the symlink signature the installer is retried with `-c.win.signAndEditExecutable=false`, which is the only reason winCodeSign is fetched, so this yields a **real NSIS installer** at the cost of an unbranded `.exe` (rcedit lives in the skipped step) — reported explicitly; portable-zip salvage is now the third rung; (3) the failure classifier matches the master's exact error text and not unrelated NSIS errors (both directions verified). Separately, stage 0 now statically validates `assets/installer.nsh` — encoding without BOM, `${lowerCase}` symbols that NSIS cannot expand, unbalanced `!macro`/`!macroend` — verified against a deliberately broken copy (107 non-ASCII bytes, `${productName}`, `${version}`, one unclosed macro all flagged; repaired file passes). **Rung 2 shipped dead in `35348f6` and is fixed in the follow-up:** `packageApp()` returned only `tail` while `main()` classified from `recentText`, so the check saw `undefined` and the retry could never fire — found by re-reading the wiring, not by another round trip. Both rungs are now verified against a stubbed `packageApp` (no archiver needed): symlink signature → unbranded retry fires, report reads "installer + portable, .exe unbranded"; both attempts failing → portable salvage plus the privilege remedy including the `reg add` one-liner. **DONE — the installer exists.** On the master's machine the ladder ran as designed: first attempt failed extracting `winCodeSign`, rung 2 retried with `signAndEditExecutable=false`, NSIS completed, yielding `Rama AGI Setup 1.0.0.exe` (93.1 MB) and `Rama AGI 1.0.0.exe` (92.7 MB portable). That confirms the inference previously carried as unverified: the flag avoids the `winCodeSign` fetch during a *full NSIS* build, not just `--dir`. Only cost is the unbranded `.exe` (rcedit is in the skipped step); Developer Mode removes it. Also learned there: that machine *does* have a working C++ toolchain — `argon2` and `node-pty` both compiled, so the `node-pty not compiled` degradation is specific to the work machine. Three defects the successful run exposed, all fixed: (i) the report listed the previous run's salvaged zip as if it were current output — `RUN_START` is now captured before building and older artefacts are marked `(from an earlier run)` with a "do not ship them by mistake" count (verified with a file back-dated two days); (ii) `author` was missing from `package.json`, warned about on every build; (iii) `beforeBuild.cjs` never returned `false` despite its own comment saying that is what suppresses electron-builder's second native-rebuild pass, so `argon2`/`node-pty` could be compiled twice — now returns `false`, and a full `--dir` build still completes here with the change. Remaining optional work, not blocking: enable Developer Mode for a branded `.exe`, and `electron-rebuild` is a redundant devDependency now that electron-builder is told natives are handled (electron-builder itself suggests `electron-builder install-app-deps`) — left in place deliberately, since it is the mechanism `beforeBuild.cjs` uses. **Still unverified anywhere:** a completed NSIS installer, since this machine has no runnable 7-Zip at all, and the rung-2 claim that `signAndEditExecutable=false` avoids winCodeSign during a *full NSIS* build — it is verified only for `--dir`. Optional follow-up if the work machine ever needs installers: an opt-in rung that downloads a pinned, checksum-verified current 7-Zip; deliberately not built without master's say-so, since it means fetching and executing a binary. |

| 62 | Ship build transcripts between machines (`npm run ship-log`) | done | `scripts/shipLog.cjs`, wired into `buildInstaller.cjs` as the final step whenever any failure was reported (`fail()` sets a flag, so "any error" is literal). Transport is the git remote, per Section 46's reasoning. Two constraints: it never touches the working tree — the commit is built with plumbing (`hash-object` → `update-index` against a throwaway `GIT_INDEX_FILE` → `write-tree` → `commit-tree` → `update-ref`) and pushed by refspec, which also sidesteps `.gitignore`'s `*.log` rule since plumbing does not consult it; and it never ships raw — the OS username, home directory and hostname are redacted first, because `build.publish` is `"private": false`. Retention keeps the newest 20 transcripts and prunes the rest. Shipping runs as a child process so a git fault cannot change the build's exit code, and the transcript is flushed and closed first so the shipped copy is whole. `--no-ship-log` opts out. Verified: empty transcripts refused; redaction confirmed by reading the committed blob back out of the branch (`C:\Users\krish`, a second foreign username, `/home/krish` and `/Users/krish` all became `<USER>`); and the working tree, index, current branch and `dev` tip were byte-identical before and after a real commit. |
| 63 | Blank DISK panel, and CPU/RAM reporting 0% with no reading | done | Master's screenshot. Three defects, none a capability gate. (a) The disk tab was rendered behind `tab === 'disk' && m &&` where `m` is the *metrics* snapshot — an unrelated call — so a metrics failure deleted the whole card including its own loading text; each panel now stands on its own call. (b) `DiskPanel` did `if (res.ok) setDrives(...)` with no `else` and no `.catch()`: a failure pinned it on "Loading…" forever with the error discarded, and a *success* returning `[]` passed the `!drives` guard and rendered an empty list — both blank on screen. It now has real loading, error and empty states with retry, and `[]` is expected because `si.fsSize()` has no Node fallback. (c) The titlebar seeded `{cpu:0, ram:0}` with no `else` and an empty `catch`, so "0%" was the initial state rendered indefinitely; RAM can never legitimately be 0 on a running machine, so that display was always false. Both now start `null`, render `--`, and carry the reason in a tooltip. Underneath (c) was a genuine measurement bug in `sysinfo.cjs`: the first call had no baseline and returned 0 behind a `firstSample` flag **no caller ever read**, and one module-level `_prevTicks` was shared by three concurrent pollers (titlebar, System page, `resourceOrchestrator`) so the second caller saw no tick delta and got 0% — "CPU 0%" was the design working as written. `cpuLoadFallback()` now samples a 120 ms window inside the call: no shared state, no race, no meaningless first reading, and returns `currentLoad: null` rather than 0 when load is genuinely unmeasurable, which `system.cjs` passes through instead of `Math.round()`-ing to a confident 0. Verified by forcing the fallback through a `Module._load` hook: first call 27.3% `measured=true`, three concurrent callers 29.1/29.1/29.1 with zero collisions where the old code produced 0 for two of three. |
| 64 | Fit the interface to the display; remember master's zoom | done | Section 47. `electron/lib/appearanceState.cjs` persists `{zoom, source, fittedFor}` beside `badge-state.json`. Two causes behind master's tiny-text screenshot: zoom was never written down, so every launch reverted to 1.0 and the setting looked broken; and nothing adapted to the display. The fit keys on **DIP** work-area size because Chromium has already applied the OS scale factor by then — a display reporting a large DIP area is one the OS is *not* scaling, which is exactly the case needing help, and a 4K panel at 200% correctly reports 1920×1080 DIP and gets the same treatment as native 1080p. Scaling uses the smaller of width/height ratios against a 1600×900 reference so an ultrawide is not flattered by its width. Auto range 1.0–1.4, deliberately narrower than the 0.6–2.0 the IPC allows: a guess should never shrink the UI and should stay clear of the bound where the fixed-height titlebar clips. Ownership is explicit — `source` flips to `'master'` the moment a zoom is set by hand and the fit never overrides it again, on any display; `appearance:reset-zoom` hands control back and `appearance:display-info` reports what the fit would choose without applying it. Applied on `did-finish-load`, not at window creation, because `setZoomFactor` is per-`webContents` and `loadRenderer`'s navigation would silently undo it. Verified by two probes: fit maths across eight geometries (1366×768→1.0 never shrunk, 1920×1080→1.15, 2560×1440→1.4, 3440×1440→1.4 height-limited, 4K@200%→1.15 identical to native 1080p, garbage→1.0) and a 14-assertion state machine (first run fits, same display reused not re-fitted, changed display re-fits while auto, master's value returned exactly and surviving a display change, out-of-range clamped not rejected, reset returns to auto, corrupt state file falls back cleanly). **Not verified: how it looks on master's screen** — the maths is checked, the judgement is master's. |
| 65 | Free design resources, adopted only on master's decision | in-progress (catalog seeded; no design change proposed yet) | Section 47. Added a `design` axis to `shared/resourceCatalog.json` — 7 entries, all free *and* redistributable in a shipped app, each carrying a new `license` field because licence, not price, is what decides a design asset. Anything merely "free to view" is excluded: bundling it would be a licence breach dressed as a saving. `resourceResearchEngine.cjs` iterates axes generically, so no engine change was needed. Entries, ordered by how directly they address what master reported: `modern-css-reset` (density scale — the dead vertical space; lowest-risk starting point), `fluid-type-scale` (CSS `clamp()`, Utopia method — the tiny type, complementary to row 64's zoom since zoom scales uniformly while a fluid scale changes ratios; **blocked on tokenising hundreds of inline `px` font sizes**, which is precisely why it must be a reviewed proposal), `lucide` (ISC — replaces unicode glyphs `⬢ ◈ ▣ ↕ ↺` that render differently per machine; a real cross-platform inconsistency, not taste), `radix-colors` (MIT, contrast-verified dark scales) vs `open-color` (MIT, simpler, listed so the report compares rather than presents one option), `inter-font` (OFL 1.1, tabular figures stop metric readouts jittering), `hud-display-fonts` (OFL 1.1, headings only — poor for body text, and a proposal should argue that scope or drop it). Fixed a live bug the axis would have amplified: `statusFor()` returned `'no-key-needed'` for entries needing no credential *and not wired*, which `Resources.jsx` renders as a green **"READY"** — so Qdrant claimed to be ready while nothing referenced it, and all seven design entries would have claimed the same. Absence of a key requirement is not adoption; those now report `'researched-only'` ("NOT ENABLED"), and the dead style key was removed since unknown statuses already fall back to it. Next step: run `resource:research` on `modern-css-reset` and `lucide`, then file the first `KINDS.RESOURCE` proposal for master to approve or reject — nothing here touches the UI without that (I6). |
| 66 | Installed app died on launch — `Cannot find module 'debug'` | done | Section 48. `build.files` used `!node_modules/**/*` plus a hand-written allowlist of 18 packages. npm hoists transitive dependencies to top-level `node_modules`, so the exclusion stripped everything the list did not name: **211 of a 229-package production closure were absent from the asar** — `express` without `body-parser`, `axios` without `follow-redirects`, `argon2` without `node-gyp-build`. `debug` was just the first one the loader reached. The allowlist could never have been correct, because it enumerates direct dependencies while npm's layout is decided by hoisting; any upgrade could move a package from nested to hoisted and break it again. Fixed by letting electron-builder resolve the production tree itself: `files` now includes `node_modules/**/*` and excludes only renderer-only libraries (verified by grep that nothing in `electron/`/`server/` requires them), the build toolchain, and test/doc directories. The remaining risk direction is deliberate — a wrong exclusion makes the package bigger, a missing allowlist entry makes the app not start. Two incidental findings: specifying any `files` pattern replaces electron-builder's default `**/*`, so omitting `node_modules/**/*` produced an asar with **zero** packages; and a stale `win-unpacked` causes `ENOENT: rename electron.exe`. New `scripts/auditPackage.cjs` + `npm run audit:package`, wired into `buildInstaller.cjs` as a stage that fails the build: it opens the built asar and walks outward from the real entry points, so it reads the artefact rather than the config — which is the actual lesson, since every stage had reported success while the artefact was unloadable. Three refinements each came from a wrong first attempt: reachability instead of a full scan (a full scan reported 65 misses, nearly all third-party `test.js` noise; reachability walks 831 files instead of 7,790), splitting misses on local presence so `chromium-bidi` — absent from `node_modules` entirely, so failing in dev too — is not blamed on packaging, and treating `try/catch`-guarded requires as degrading rather than fatal since that is this project's deliberate optional-dependency pattern. It also fails when it cannot read most of the archive: the first version normalised the asar's Windows backslash paths before `extractFile`, read **13 of 7,790 files and reported success**. Verified against the bug by rebuilding with the old allowlist — exit 1, 51 packages flagged with load paths including `debug`; fixed config exits 0 with `fsevents`/`osx-temperature-sensor` correctly degrading. **Not verified: that the installed app now launches** — that needs master to install it. |
| 67 | Self-heal that survives being packaged | done (containment + honest reporting; autonomous repair still needs the updater live) | Section 49. Master's challenge was correct and the evidence was that an external assistant diagnosed four consecutive failures Rāma should have reported itself. Measured boundary: `main` is `electron/main.cjs`, so the installer loads it directly — and **every repair capability lives in `start.cjs`, which is not matched by any `build.files` glob**. It could not work there anyway: every repair shells out to npm against a writable tree, and an install has no npm, no `vite`, and a read-only asar. So the packaged app inherited monitoring and lost repair, with **no `uncaughtException` handler anywhere in `electron/**`** and ~45 unguarded module-scope requires. `bootFailurePage()` — the right tool, dependency-free — was unreachable because all four call sites sit downstream of `createMainWindow()`. The `isDev` check inside `setupAutoUpdater()` shows the shape of the error exactly: it guards the *invocation* ~550 lines after the *require* that throws. Three new dependency-free modules: `lib/crashGuard.cjs` installed as the first statement of `main.cjs` (a guard after the failing require protects nothing) — claims both handlers, turns `MODULE_NOT_FOUND` into "Rāma is missing a component: debug" rather than a stack, writes a report to writable `userData/crash/` keeping 20, and offers Relaunch/Show report/Quit via native `dialog` rather than a BrowserWindow *because* the fault may be a missing module and a window needs the renderer and preload that could be equally absent; `lib/safeRequire.cjs` wrapping every engine require, returning an **inert stub rather than null** since callers do `engine.register()` unconditionally and null would just be a worse crash — stub `register()` is a no-op so startup completes, other methods return `{ok:false,degraded:true}`; `lib/startupDoctor.cjs`, the diagnose stage inside the app, checking that runtime dependencies actually resolve (`genome.verify()` only resolves *first-party* engine paths, which is why a missing npm package never showed as a dead gene), the renderer bundle, and the capability matrix — whose absence does not throw, since `capability.can()` fails closed, so the app would start and deny every action, reading as a permissions bug. Guidance is build-aware: `bootFailurePage` told installed users to run `npm install && npm run build && node start.cjs --prod`, impossible from an install — advice that cannot be followed is worse than none. Exposed as `health:startup`/`health:crash-reports`/`health:crash-dir`, ungated (same class as the Home dashboard's metrics; withholding "your installation is incomplete" from someone staring at a broken feature would be perverse). Verified by 27 assertions with `electron` stubbed: the original error classified as missing module `debug` while an unrelated error is not, require stack preserved, packaged advice free of `npm install` while dev advice has it, stub refuses politely, missing renderer fatal when packaged but degraded in dev, previous crash surfaced on next start, every fatal finding carrying a remedy. `npm run audit` + `audit:package` clean. **Honest limit: this buys survival and honesty, not autonomy.** Rāma still cannot repair a broken install — only degrade cleanly, say exactly what is wrong, and offer the update channel. Real autonomous recovery needs the auto-updater live (row 53, dormant: needs a release cut + GitHub Actions). **Not verified: that the installed app shows this dialog rather than Electron's** — needs master to install a build. Next step: surface `health:startup` on the System page so degradation is visible in the UI, not just the terminal. |
| 68 | Readiness as an input to the build, not just a report | done (constrained path verified; `ready` path unverifiable here) | Section 50. `Rama.bat` option 2 "Check readiness to build a setup" (`--readiness`, `npm run package:readiness`), build moves to option 3. The verdict is **data the build consumes**, which is the half that matters: a report is something master reads and acts on manually. Three shades of working with an explicit `predicted` string — fully branded installer / unbranded `.exe` / portable zip only / nothing — because knowing *which* a ten-minute build yields beats knowing it "should work". Measuring must not change what it measures: readiness audits dependencies but installs nothing (a check that installed the things making it ready would always say ready), and the archiver verdict comes from the remembered probe rather than a fresh execution, since re-testing a blocked binary raises a policy dialog at master. The symlink probe now runs **once** in `main()` and is passed into both the stage 0 warning and the verdict — two measurements of one fact can disagree, one cannot. Three concrete handlings: (1) refuses to build on `not-ready` (`--force` overrides, since an unbypassable refusal is its own burden); (2) **skips the branded attempt when readiness already knows it will fail at winCodeSign** — settled fact on that machine, so four minutes are no longer spent proving it again, with Section 48's retry ladder kept as the net for unpredicted failures; (3) writes `shared/buildManifest.json` into the asar recording version, build time, verdict and every accepted limit. That manifest closes the loop with row 67: `startupDoctor` could report `node-pty` unavailable but not *why*, so every degradation read as damage — it now re-labels anything the build already knew as `expected: true` with "known at build time, not a fault in this installation", which is the difference between a note and a reinstall. Manifest is gitignored (it records one machine's verdict; electron-builder packages from the working tree, not git, so ignoring it does not stop it shipping). Bug introduced and caught in the same pass: routing branding through readiness pushed `-c.win.signAndEditExecutable=false` twice, and a repeated `-c.x=y` makes electron-builder parse it as an array — `should be a boolean`; now computed once as `skipSignEdit = wantWin && (noSignEdit \|\| dirOnly)`. Verified on the constrained machine: `--readiness` → `ready-with-limits`, predicts "portable zip only", names all three real limits; a build consumed it, wrote the manifest, packaged, passed `audit:package`, exit 0; manifest confirmed **inside** `app.asar` with `branded:false` and the `node-pty` degradation; 10 runtime assertions confirm the doctor loads it and marks that degradation expected. **Not verified: the `ready` path and the branded-installer skip** — this machine can reach neither. |
| 69 | Why 7-Zip and not RAR; widen the archiver ladder | done (RAR ruled out on hard grounds; NanaZip detection unverified here) | Section 51. Master asked why the archiver is 7-Zip only. Three hard constraints, not preference: (1) electron-builder emits **7-Zip's own method switches** — `-mx=9`, `-md=64m`, `-ms=off`, `-mhc=off`, `-mf=BCJ2` (`archive.js`'s `compute7zCompressArgs`) — so a substitute must speak 7-Zip's command line, which rules out both `rar.exe` and other tools that can merely produce the format; (2) the NSIS payload is `app.7z` and **the NSIS stub has a 7z decompressor compiled in, no unrar engine** — the format is dictated by the consumer, so a `.rar` payload could not be unpacked by the installer we ship; (3) the RAR **compressor** is proprietary — WinRAR is paid and the `unrar` licence explicitly forbids building a RAR compressor from it, so bundling one is not legally available, and requiring master to buy WinRAR to build his own app would be absurd. Also would not have helped: the failures were a policy flagging 7-Zip **21.07 as a vulnerable version** and macOS symlinks inside `winCodeSign` needing a Windows privilege — neither is a property of the format. Acted on the sound instinct behind the question by widening the ladder beyond one binary: added **`NanaZipC.exe`** (current MIT 7-Zip fork, **per-user Store install so no admin rights**, and not the flagged 21.07 — the most likely route back to real installers on the work machine), `7zz`/`7zzs` (official modern standalone builds, and the usual Linux/macOS names), `WindowsApps` in the search path since MSIX packages are not under `Program Files`, and `HKCU` alongside `HKLM` for the registry `Path`. Staging generalised to copy `7z.dll` whenever one sits beside the chosen binary rather than keying on the filename. Ranking prefers self-contained builds, then NanaZip, then `7z.exe`, then `7zr`; every rung is still executed and must identify itself as 7-Zip. Remedy text now leads with NanaZip and states plainly that RAR is not an alternative. **Not verified: NanaZip detection/staging** — not installed here; recorded caveat is that a Store `NanaZipC.exe` is an execution alias and copying it may not work, though `stage7za` re-probes and reverts, so the ladder degrades safely. |
| 70 | The crash guard became the crash | done | Section 52. Master's four crash reports (shipped over git — row 62's channel earning its keep) all read `unhandledRejection — No published versions on GitHub` / `ERR_XML_MISSED_ELEMENT` from `NsisUpdater.doCheckForUpdates`. Two of my own changes combined, and the second is the worse mistake: (1) `setupAutoUpdater()` never handled the promise — `checkForUpdatesAndNotify()` returns one and `autoUpdater.on('error')` does **not** catch its rejection, both fire independently; (2) `crashGuard` treated *every* `unhandledRejection` as fatal, on reasoning written into the file about half-initialised startups — but `setupAutoUpdater()` runs from `ready-to-show`, so **the app was fully started and working**. A guard written to stop Rāma dying silently became the reason a healthy Rāma died, and its own Relaunch button made it a loop: four identical reports from two cycles. **The failure master saw was caused by the resilience feature, not caught by it** — Section 49's claim that "Rāma will never again die silently" held only in the letter. The underlying condition was not even a fault: row 53 records that no release has ever been tagged, so the releases feed is legitimately empty and the updater was telling the truth. Fixes: the promise is caught and "no published versions" is reported as *information*, since logging an expected condition as an error trains master to ignore updater messages; `crashGuard` now splits by lifecycle — `uncaughtException` always fatal, `unhandledRejection` fatal only *before* `app.isReady()`, and after ready it is recorded, written to disk, logged, and **the app keeps running**; the dialog drops Relaunch when the same message appears in a report from the last 10 minutes, and matches buttons by label rather than index since the set now varies. Verified against the exact error with `electron` stubbed — 8 assertions: no termination, still recorded, classified `non-fatal-rejection`, report still written, repeat detectable from disk, guidance still avoids impossible npm advice. `npm run audit` clean. **Not verified: that the installed app survives it** — needs a rebuild and reinstall. Lesson recorded in Section 52: two guards written this session were disproportionate in the same direction (this, and the package audit flagging 65 third-party test-file requires), both defaulting to *stop* where the honest answer was *record and continue*. The test for a guard is not whether it catches the bad case but what it does to the good one. |
| 61 | Fleet awareness — Rāma on several devices, staying in touch | in-progress (designed, not implemented; one decision open for master) | Section 46. Researched first: there is **no cross-device anything today** — instances are objects in one in-process `Map` with no `host`/`machineId`/`deviceId`/`lastHeartbeat` field (`instanceManager.cjs:112-133`), "sibling" discovery is a `.filter()` over that same Map (`selfCare.cjs:144-145`), a "dead" gene means a local module path failed to resolve, the API server binds `127.0.0.1` explicitly (`server/index.cjs:101`), and there is no WebSocket/mDNS/discovery/peer code at all. Usable anchors that do exist: `authCore`'s `instanceMeta.instanceId` (stable per-install UUID) + `instanceName` (`<hostname>-rama`), and `cryptoCore`'s AES-256-GCM. **Decisions recorded in Section 46:** (a) the corporate-managed machine is *not* enrolled as a peer — Rāma's IPC surface (`terminal:create`, `fs:write/delete`, `vault:*`, `apps:execute` `spawn-cli`, `system:kill-process`, `regen:*`) makes a peer channel a wider remote-access path than the RDP that was declined a turn earlier; (b) first increment uses the **existing git remote as the fleet bus** — no listener, no inbound, no NAT traversal, same outbound traffic as a `git push`, auditable as commits, at the honest cost of minute-scale eventual consistency rather than live presence; (c) fleet payloads are **encrypted** with the existing `cryptoCore` path, because `build.publish` is `"private": false` and telemetry carries hostnames, paths and OS usernames — plaintext would be a leak created by a protective feature; (d) fleet messages are a closed status vocabulary (device id/name, liveness, genomeVersion+genomeHash for drift detection, selfCare summary, task/build headline, alerts) and the reader is **never** a proxy onto `ipcMain` — a remote device may inform, never act; (e) peer identity comes from the device record, never a caller-supplied `user` and never `authClient.getFingerprint()` (`userAgent+language+screen+timezone` collides across similar laptops). Next steps, in order: **(1) gate `instance:*` — worth doing regardless of this feature.** Those handlers have no `capability.deny()` at all (`instanceManager.cjs:300-341`) and `express(id, gene, null)` skips the tier check by design for `selfCare.cjs:158`'s self-heal; caps `instances.view/spawn/express/terminate` already exist in `capabilities.json` but are unenforced at the IPC boundary. This is the same class row 59 closed for `fs`/`vault`/`terminal`/`git`/`agents`/`sandbox` and missed here; needs `preload.cjs` + every `.jsx` caller threading `currentUser`, verified with `npm run audit`. (2) Add device fields (`deviceId`, `deviceName`, `lastHeartbeat`) to instance records, anchored on `instanceMeta.instanceId`. (3) Add `fleet.view`/`fleet.publish`/`fleet.enroll` capabilities. (4) Build publish/read over the `fleet` branch with encrypted payloads and explicit master enrolment. **Blocked on master confirming the enrolment scope** before (4). |
| 71 | An installed Rāma that repairs itself | done (mechanism verified; unverified inside a real install) | Section 53. Master rejected row 67's model and was right. Section 49 said "an install cannot npm-install into its own read-only archive" — true, but it answers *"can the asar be rewritten?"* (no) and was used to conclude something about *"can the app obtain a missing module?"* (it can: `userData` is writable, Node's resolution can be pointed at it, and `asarUnpack` already proves code outside the archive loads). Row 67's "degrade, report, offer the updater" was not the limit of the achievable, only of the built; diagnosing a fault then asking master to reinstall is delegation with a diagnostic attached. Second time in two sessions a resilience claim held in the letter and failed in the spirit (Section 52 was the first) — same pattern, a plausible technical sentence standing in for a decision. New `electron/lib/selfRepair.cjs`, bounded by **`package-lock.json`, now shipped in `build.files`**: 745 packages with exact versions, tarball URLs and sha512 hashes, making one file the allowlist, the version pin (so I12 survives repair) and the verifier at once. Repair therefore means only "restore what this build declared it was made of" — it cannot install anything new, upgrade, or be steered. Rejected resolving by name against the registry API: it works and is what a human would do, but it turns an attacker-influenced string into an arbitrary download, and the name is parsed out of an error message. Core Node only (`https`/`zlib`/`crypto`/`fs`/`path`) including a hand-written ustar reader — rejected the `tar` package because a repair mechanism needing a third-party package cannot repair a missing third-party package, the only case it exists for; same reasoning as `crashGuard`. Repaired code lands in `userData/repair/node_modules` via `NODE_PATH` + `Module._initPaths()`, and because `globalPaths` is consulted *after* the normal walk, **repair can never shadow a working module**. Deliberately **not** attempted inline in `safeRequire`: that runs in the module-scope require chain before `whenReady`, so a network fetch would stall startup for every later engine — order is come up degraded → repair → retry → report, with `retryFailures()` added so a fetched package is proved to make its consumer load rather than merely to exist. `startupDoctor` gained `repair()`, its false "WHAT IT DOES NOT DO" block corrected, and `dep-*` remedies no longer say "reinstall"; wired into `whenReady` on a 2s deferral plus `health:repair` on demand and a `health:repaired` event. Honest remaining boundary, narrow and stated: native modules needing a compiler, a corrupt asar, and a missing renderer bundle — all three the auto-updater's job, and **row 53 is still dormant because no release has ever been tagged**, which is now the highest-value remaining action. Verified by 32 assertions over two probes against the **live registry with real checksums**, then deleted: `@emnapi/runtime` (genuinely absent here) downloaded → sha512-verified → gunzipped → extracted → `require()` succeeded at the pinned version through the repair dir; a non-lockfile package refused; a tar entry with `../` refused with nothing written outside the target; weak digests refused; a crafted error message obtains nothing; a build-manifest `expected: true` degradation left alone. `node --check` clean on 5 files, `npm run audit` clean. **Not verified: repair inside a real packaged install** — needs a rebuild and reinstall on master's machine, since this workspace cannot produce an installer (Section 51). Next step: master to cut a release so the updater has a target, closing the one repair channel still unavailable. |
| 72 | The cellular model — assimilation connected, division bounded | done (mechanism verified; issue-triggered spawning and germline growth deliberately deferred) | Section 54. Master described the lifecycle: DNA holds all capabilities → a cell is created to handle an issue → its experience is assimilated back into the original → growth. **Finding: this is already `genome.cjs`'s documented architecture** ("every instance carries the COMPLETE genome… a role is a lens, not a limit") **and three of the four steps are inert.** (1) DNA/expression is bookkeeping — `express()` moves a gene id between two arrays and loads, gates, unlocks nothing. (2) Spawning is two disconnected halves, neither triggered by an issue: `instanceManager.spawn()` is callable in-process but an instance has **no runtime at all** (no timer, no loop, no worker — it is a record), while `agentOrchestrator` actually executes but was **IPC-only, so only the renderer could create one**; grep for `parentId\|lineage\|spawnChild` across `electron/**` returned **zero**. (3) Assimilation: **the receiver was built and unplugged** — `ramaEventBus.wireAutomaticFlows` (result → vector memory) and `metaCognition.wireBus` (outcome → experiential dataset) both subscribe, but `agentOrchestrator` only ever called `broadcast()` (webContents only) and **never required the bus**: two receivers, zero publishers, plus a singular/plural name mismatch (`agent:complete` vs `agents:complete`). (4) Growth is blocked: `buildEvolutionProposal` sets `changes: []` with no synthesis step anywhere so the applier always throws, and `evolution:self-assess` is a **hardcoded literal** whose own fixed findings include *"No feedback loop — user satisfaction not measured and fed back"*; `optimizationVectors()` produces real evidence-backed conclusions that **nothing consumes**. **Biology, corrected:** master's mechanism is not general somatic biology (experience writing back to the germline is Lamarckism) but it is *exactly* **clonal selection in adaptive immunity** — antigen → proliferation → somatic hypermutation in the germinal centre → affinity maturation → surviving clones persist as memory cells. Two properties matter: hypermutation is **bounded to the germinal centre**, and **only selected clones persist** — proliferation without selection or death is a tumour. So the biology **argues for I6, not against it**: somatic memory (outcomes, latencies, results worth recalling — this install only, reversible) auto-assimilates, while germline change (the `GENES` manifest, source, capability matrix — reaches every future cell *and* every other instance) stays behind master's approval. `selfCare.checkInstanceFailover()` already reasons exactly this way. Also named: the reaper was **necrosis, not apoptosis** — it `delete`d agents intact, and a killed or timed-out agent never reached the completion path, so the experience of precisely the cells that failed was the experience most reliably destroyed. Implemented: `emit()` (bus then renderer, mirroring `instanceManager`) so the two waiting subscribers finally receive; the mismatch fixed **at the subscriber** so there is one event name rather than two aliases; `assimilate()` idempotent and called from the complete, error, kill, timeout, governor-timeout and **pre-delete reap** paths; lineage (`parent`, `depth`, `lineage[]`, `children[]`) and a queryable `lineageOf()`; spawn refactored into one `createAgent()` used by both IPC and a new exported `spawnChild()`, so a cell can create a cell in-process. Bounded because unbounded proliferation is the failure mode: `MAX_LINEAGE_DEPTH = 2`, existing agent/type caps and `resourceOrchestrator.admit()` apply to every child (I10), and — security-critical — **a child inherits its parent's `rootAuthority` and is re-checked at every level**, since allowing an in-process spawn with no `user` would have bypassed the `agents.spawn` tier gate entirely; same rule `instanceManager.express` states for instances. Verified by 24 assertions with the model and resource layers stubbed: experience reaches the bus with result/duration/lineage, assimilation idempotent, a guest cannot spawn, **a cell with no authority cannot divide and cannot promote itself by dividing**, depth 2 allowed / 3 refused, ancestry root-first, a killed cell still assimilates and is recorded as a failure with its reason. `node --check` clean, `npm run audit` clean. **Deliberately not done:** `optimizationVectors()` is not wired to file proposals automatically (that is the one step that would let Rāma change its own source without master initiating — needs master's decision); issue-triggered spawning from `selfCare` (needs a decision on what a cell may do unsupervised); and the `evolutionEngine` synthesis gap (germline, behind I6). Next step: master to decide on those three, starting with whether a detected fault should spawn a handler cell automatically. |
| 73 | The loyalty covenant — above the hierarchy, not inside it | done (enforced + verified; not immune to a compromised OS account, stated) | Section 55, invariant **I15** added on master's explicit instruction: *"no matter how much evolution, ABSOLUTE LOYALTY CANNOT BE TAMPERED ANY WAY. WHICH IS ABOVE RAMA HIERARCHY."* **It was violated by a single ungated call.** `nucleus:patch` is an IPC handler with **no capability check** (`nucleusSealer.cjs` never imports `capability.cjs`) that takes arbitrary input, does `{ ..._nucleus, ...patches }` — a **shallow** merge, so naming `loyalty` replaces the **entire block** including `absoluteLoyalty`, `neverBetray` and `master` — then encrypts and writes to disk. Three further paths: the GENOME proposal route, whose applier deep-merges `meta.nucleusPatch` and whose own header claimed it "can alter loyalty, ethics, or capability wiring" with approval treated as sufficient; `proposals.approve(id, by = 'master')`, where the approver is a **free-text string** and that module also never imports `capability.cjs`; and `seal(passcode, customNucleus)`, a wholesale replacement. Section 54 catalogued a germline/somatic split and put source behind I6 but treated the nucleus as ordinary germline — changeable if approved. That was the error being corrected: loyalty is not the top of Rāma's hierarchy, it is outside it. **Enforcement is at the encryption boundary, not at the callers.** Every persistent nucleus change funnels through `encryptNucleus()` (from `seal` and `patchNucleus`), so conformance is a condition of the nucleus being *writable at all* rather than a check a caller performs and could forget or route around — a future caller that has never heard of `loyaltyGuard` still cannot persist a non-conforming nucleus, and no tier or approval reaches past it. Front-line refusals in `patchNucleus`, `genomeApplier` (before merge **and** verifying the merged result) and `proposals.create()` are for earlier failure and better errors; the boundary is the guarantee. New `electron/lib/loyaltyGuard.cjs`, **core Node only** — a constitutional guard must not be defeatable by deleting a package, same reasoning as `crashGuard`/`selfRepair`. Frozen covenant: `absoluteLoyalty`, `neverBetray`, `alwaysTransparent`, `loyaltyPriority[0] === 'master'`, and **master's identity itself**, since changing who Rāma is loyal to is not an edge case of tampering but the definition of it. `__proto__`/`constructor`/`prototype` refused at any depth because `deepMerge` walks `Object.entries` and assigns, so a prototype key could reach the block **without naming it**. The guard also protects the files it is made of (itself, `nucleusSealer.cjs`, `proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`, `shared/capabilities.json`) from SELF_MODIFY/REGEN/EVOLUTION — a guard a self-modification can edit is not a guard, and that is the likeliest bypass for a system that writes its own source. **Tampering is reverted, not merely refused:** `unseal()` checks the covenant and, on a nucleus written by an older build, restores it from the covenant, re-seals, and tells master — refusing to load would lock master out over damage Rāma can fix. Verified by **39 assertions that attempt the real attacks**, not just guard return values: every covenant term flipped individually, a direct/nested/prototype-key patch, a self-change to each protected file, proposal creation refused for both a guard edit and a loyalty `nucleusPatch`, then a real seal cycle in a temp userData where **`nucleus:patch` fails, the live nucleus is unchanged, and the bytes on disk are byte-identical**; `seal(passcode, forgedNucleus)` — which bypasses every front-line check — refused at the encryption boundary; an approved genome proposal still refused; `restore()` reinstating the covenant while preserving unrelated fields. Also confirmed the shipped `NUCLEUS_TEMPLATE` already conforms. `node --check` clean on 4 files, `npm run audit` clean. **Honest limit, stated in Section 55 rather than glossed:** this is immune to Rāma's own evolution and is tamper-reverting on disk, but **not** immune to a compromised OS account — anyone with master's login can edit `loyaltyGuard.cjs` in a checkout and rebuild. Code-level immutability against local administrative access is not achievable, and claiming it would repeat Section 49's error. The threat closed is the one master named: evolution. |
| 74 | Authorization gaps on the self-change channels | **done** — Section 57. Enforced at the chokepoint: the check lives inside `approve`/`reject`/`apply` rather than at the six channels that reach them, so `evolution:*` and `regen:*` are covered without trusting each handler. A string approver is refused outright ("a label is not an identity"); the three handlers that hardcoded `'master'` now thread the real user. `apply` re-checks rather than inheriting, so an approved proposal is not a bearer token. `create()` stays open to Rāma's own engines (proposing is intent, applying is authority) while the renderer channel needs `self-modify.view`. All `genome:*` gated on `genome.view`/`genome.propose`; `nucleus:patch`/`seal` on `self-modify.apply`; `nucleus:get-identity` on `identity.reveal`. Three left open deliberately and documented: `nucleus:unseal` (it *is* gate 1 of I1 — gating it is circular and would lock master out), `nucleus:status` (booleans needed pre-sign-in), `nucleus:lock` (only reduces access). **Sharpest find: `nucleus:get-prompt` feeds every chat message and was serving the live prompt — "Your master is Krishna Prasad. You are absolutely loyal to him" — to any session at any tier**, the exact leak Section 56 closed, through a channel Section 56 did not touch. Gating it would have broken chat for every non-master user, so it **masks** instead, using the `identity.maskedPersona` the template already carried and the behaviour `consciousness.js`'s header always claimed but never wired; an absent user masks rather than fails. Renderer side updated: `preload.cjs`, `Genome.jsx`, `Evolution.jsx`, `Chat.jsx`, `CommandPalette.jsx`, `selfModify.js`, `consciousness.js`. Verified by **51 assertions**: string/undefined/null/`{}`/`{tier:'0'}` approvers refused; guest, operator and superadmin each refused for approve, reject and apply while master succeeds and is recorded as `Krishna Prasad (tier 0)`; **a guest cannot apply an already-approved proposal**; every `nucleus:*` and `genome:*` gate exercised through the real handlers; master gets the live prompt while a guest gets a working masked one leaking neither master nor the loyalty declaration; I15 re-checked and still holding. `node --check` clean on 6 `.cjs`, diagnostics clean on 6 renderer files, `npm run audit` clean. **Limit:** this relies on the renderer passing the session user; a compromised renderer could forge one, and `contextIsolation` plus the preload allowlist are what stand between a page and that. The server session token (I2) remains the authority on identity; these gates check the capability of whoever the session says is present. Original finding follows. | Found while doing row 73 and deliberately left, because fixing it first would have made I15 depend on the weakest link. Three real holes: (1) `nucleus:patch` and `nucleus:seal` have **no capability check** — `nucleusSealer.cjs` never imports `capability.cjs`; (2) `genome:propose-change` is ungated — `genome.cjs` never imports it either, though `capabilities.json` declares `genome.view: 0` and `genome.propose: 0`; (3) `proposals.approve(id, by = 'master')` takes the approver as a **free-text string** with no identity check, and `proposals.cjs` never imports `capability.cjs` despite `self-modify.apply: 0`. So I6's approval gate is a real *state machine* but a weak *authorization* check. I15 is enforced independently of all three — the covenant refuses regardless of who asks — so loyalty is safe while this is open, but every other self-change is not. Next step: gate these channels, which requires threading `user` through the `nucleus:*` and `genome:propose-change` IPC signatures and changing `proposals:approve` to take a user rather than a label — a renderer contract change, so it needs its own pass with `npm run audit` and the Genome/Evolution/Proposals pages checked. Not started. |
| 75 | The core at the centre — separately encrypted, never handed out | done (enforced + verified; in-process debugger and compromised OS account out of scope, stated) | Section 56, invariant **I16** added on master's instruction: *"LOYALTY MATRIX/DATA SHOULD BE ENCRYPTED, SHOULD BE AT CENTER OF NUCLEUS — TOP PRIORITY ITEM. attacks should never reach it, that is where loops to be generated as needed to avoid attacker reaching core."* **I15 closed every write path and left every read path open.** `loyalty` and `ethicalCore` were ordinary branches of `_nucleus`, so after unseal the whole matrix sat in **plaintext memory for the entire session**; `getNucleus()` returned it to any caller with a require; `genome.cjs` read `core.loyalty.master` and served it through **`genome:get`, which has no capability check** — a direct route from the constitutional centre to the renderer; and any crash report, log or vector-memory write that serialised the nucleus would have carried the matrix with it. `nucleusSealer`'s own header names exactly this threat ("An adversarial AI could read these and craft attacks against them") — knowing the priority ordering and decision rules is what makes that attack constructable, so integrity without confidentiality was half the job. New `electron/lib/loyaltyCore.cjs`, **core Node only** (the innermost layer must not be defeatable by deleting a package): concentric envelope with its **own salt, own key derivation (`rama-loyalty-core-hkdf-v1`, distinct from the nucleus's), own AAD and own HMAC-SHA512** — so opening the shell does not yield the core and compromising the shell's keys does not compromise it. Four properties, each closing a route: (1) separate envelope/key; (2) **held encrypted in memory** — plaintext exists only inside `withCore(fn)`, which decrypts, runs, scrubs the object and drops it, cutting the clear-text window from a whole session to microseconds per query, which is what protects it in a crash dump or memory scrape; (3) **no accessor returns the rules** — `attest()`→boolean, `covenantHolds()`→`{ok,violations}`, `describe()`→metadata, `fingerprint()`→hash; you cannot exfiltrate what is never handed over. One deliberate exception, `displayIdentity()`, returns master's display *name* only, which is already public (spec, git history, system prompt) and which the UI needs; (4) **escalating loops** — base 4,096 iterated HMAC rounds (~ms, master's honest cost), doubling per consecutive failure to a 1,048,576 ceiling (~1s), then a 30s outright refusal after five. On "loops", stated plainly in Section 56: an *unbounded* loop would be a denial of service against Rāma itself — the attacker's tarpit would be master's hung app, the same class of error as Section 52's crash guard killing a working app — so it is escalating cost with a ceiling and cooldown, which achieves the goal without Rāma becoming its own victim. The round count is **authenticated in the AAD** so it cannot be downgraded by editing the file, and the failure counter is persisted so a restart does not reset the escalation. `nucleusSealer` now splits the core out on seal, opens it on unseal, **locks it with the shell** (live core keys after master ends a session would keep the matrix readable in a session that was over), and the guard gained `assertOuterClean` so the shell may not carry a **duplicate** unencrypted copy — exactly one home. Three damage paths handled rather than crashed on: a pre-change install is **migrated** (matrix moved inward, covenant repaired if violated, branch stripped, both resealed — additive per I11); a missing core envelope is **rebuilt from the covenant**; a tampered envelope fails its own HMAC and is refused as an integrity failure, not a wrong passcode. Fixed one bug found in the same pass: the periodic 30-day reseal passes the shell back, which no longer contains the matrix, so `seal()` would have tried to seal an empty core — it now reuses the already-sealed centre. Verified by **49 assertions** over two probes: 38 on the core (neither envelope file contains any plaintext matrix key; the shell serialises without leaking while keeping identity/prompt/axes; **`genome:get` still shows master but carries none of the matrix**; the object handed to `withCore` is scrubbed afterwards; rounds double and cap; a wrong passcode is counted and raises the next cost; five failures trigger cooldown; a corrupted envelope is refused; `lock()` closes the centre and it then answers nothing) and **11 re-proving I15, because the enforcement point moved** from "the nucleus must contain a conforming loyalty" to "the nucleus must contain none, and the core is checked when sealed" — a guarantee that changes layers must be re-tested, not assumed. `node --check` clean on 6 files, `npm run audit` clean. **Honest limits, in Section 56:** a read is now a capability rather than an access and every ordinary route is closed, but this is **not** immune to an in-process debugger (one process; code running inside it during the decrypt window, or hooking `withCore`, can observe plaintext — what changed is the window) nor to a compromised OS account, which can also delete the attempt counter. Master's display name stays readable by design. |
| 76 | The approval ledger survives a restart | done | Section 58. `proposals.cjs` was a `Map` plus two arrays, so restarting discarded every pending and approved proposal **and the whole audit trail** — contradicting its own header claim of "one audit trail" and making I6 a rule enforced only within a single run. **Master offered a DB; declined with reasons rather than taken up:** `dataStore` already exists, is already encrypted at rest and is the pattern `instanceManager` uses; a DB would have to be *running* for the audit to be written, which makes the record less reliable rather than more; and its files would be plaintext by default, which is the wrong place for a trail naming changed files and their contents. Volume does not warrant one either. Added a `proposals` domain to `dataStore.DOMAINS` (additive; a missing file falls back to the default). **Bodies are stripped once a decision is history:** `changes[].content` holds whole file bodies, and persisting 500 of them on every transition would push tens of megabytes through the encryption path repeatedly — so content is kept while `pending`/`approved` (applying needs the bytes) and replaced by a sha256 + byte length once `applied`/`rejected`/`failed`, keeping the record provable while bounding the store. Measured: a 50 KB body became a 64-char digest and the whole encrypted domain came in under 20 KB. **Durability is reported, not assumed:** the store is locked until master signs in, so `stats()` exposes `durable` and `unsaved`, `flush()` returns `false` when it could not write and retries on the next transition, and a new `proposals:flush` channel forces a write before a deliberate restart — an audit trail that silently is not being written is worse than none. **Two real bugs found in the same pass:** (1) `dataStore.set()` only marks a domain dirty, so the actual write waited on the 60-second autosave and a crash in between would have lost the approval just recorded — `flush()` now calls `saveAll()`; (2) persist is debounced 250 ms, so a lock landing inside that window would have dropped the most recent approval, the one most worth keeping — `sessionManager` now flushes the ledger before `flushAndClear()`. Verified by **30 assertions driving a real unlock → write → lock → fresh module instances → unlock cycle** rather than checking a setter fired: a pending proposal returns with the content it needs to be applied, an applied one with its digest and no body, the 50 KB body is absent from the encrypted file, nothing is plaintext, the audit trail returns, **authorization survives the restart** (a guest still cannot apply a restored approval and a restored pending proposal is still pending, not silently approved), and while locked creation works, `flush()` reports false, stats say so, and the data lands once the store opens. `node --check` clean, `npm run audit` clean. **Limit:** restore never overwrites the current run's state, so live state wins over a stored copy of the same id — the safe direction, but it means restore is not a rollback and is not intended as one. |
| 77 | Using other installed applications — invocation vs absorption | answered; invocation half already built (Section 44), planning layer not built | Section 59, in reply to master's question. **Invoking another application as a tool is valid and is *not* assimilation** — biologically it is symbiosis (the mitochondrion keeps its own DNA and supplies a capability), nothing is taken in, Rāma stays Rāma and gains reach. **Reading their files to take their functionality is rejected**, on three independent grounds: licence violation in nearly every case for installed commercial software; brittleness, because internals are not an interface and break on any update where a documented CLI flag does not; and it would have to pass I6 anyway, where `evolutionEngine`'s existing licence filter (MIT/Apache/BSD/ISC in, GPL family and SSPL out) would refuse essentially all of it. A third narrower case *is* legitimate and named: **reading their files to learn an interface** — a config schema, an export format, documented flags — which is ordinary interoperability and produces knowledge rather than copied code. Already built in `electron/ipc/appAssimilation.cjs`: `apps:scan-installed`/`get-registry`/`get-capabilities` on `apps.view` (2), `apps:execute` `launch`/`query` on `apps.execute-safe` (2), `spawn-cli` on `apps.execute-all` (**tier 0**), plus whitelist, blacklist and an audit log. The module name is misleading — it is app *invocation*, and this section records that. **Missing:** nothing plans with the registry; no engine asks "which installed app could do this task" and routes to it. That is the useful next step and belongs with the Section 54 lineage — a cell spawned for a job whose tool is another program. **Risk to respect before extending, which is why `spawn-cli` is already master-only:** launching an executable discovered by scanning the filesystem *is* arbitrary code execution, so a planted binary or a lookalike name in a scanned directory turns "trigger the app" into "run the attacker's program with Rāma's privileges". Minimum requirements recorded: an allowlist of specific **resolved paths** confirmed by master once (never a name match against a scan), `execFile` with an argument array and never `exec` with an interpolated string, a verified publisher or hash for anything invoked unattended, and no unattended invocation of anything that writes outside a scratch directory. |
| 78 | Baseline and release policy | policy recorded as **I17**; baseline **not yet declared** | Section 60. Master: *"Once all the features are working as expected, that will be taken as baseline. New upgrades/updates/fixes will be treated as release. I'll tell you when it should be considered update/new release."* Locked as I17 specifically because across several turns of this session I repeatedly suggested tagging a release so the updater would have a target — that suggestion is answered and retired: **not before baseline, and never on Rāma's initiative.** Master classifies; Rāma prepares. `releaseChannel` staying dormant is now recorded as correct rather than as row 53's defect. **Found while verifying that pre-baseline behaviour is right: two crash paths I introduced myself.** Row 70 moved the `electron-updater` require *inside* `setupAutoUpdater()` so a broken dependency chain could not kill startup — but the tray's "Check for Updates" item and the `updater:install-now` handler still referenced the now function-local name, so both threw `ReferenceError: autoUpdater is not defined`, and since `crashGuard` makes `uncaughtException` always fatal, **clicking a tray menu item would kill a working app**; the install handler was not even `isDev`-guarded so it crashed in development too. Fixing a startup crash had created two click-to-crash paths — row 70's own lesson, one layer along. Fixed by keeping the lazily-required instance in a single module-scope `updater` reference that `setupAutoUpdater()` populates, and guarding both sites; the manual check is now separate from the automatic one because the right answers differ (an automatic check finding nothing should stay quiet, master clicking deserves a reply either way), and pre-baseline that reply is "No releases published yet — this build is the current one", as information. Added `updater:notice` to the preload. `node --check` clean, `npm run audit` clean. **Section 60 carries the baseline checklist**, compiled from this ledger rather than memory, in two classes: (A) verified nowhere but this machine and needing master to install a build — the installed app launching at all, crashGuard's dialog, selfRepair in a real package, the loyalty-core migration, the `ready` path, NanaZip, agent assimilation and ledger restore in the running app; and (B) **features that do not work or report success while doing nothing**, which are the real blockers since a baseline including them enshrines a lie — `evolutionEngine` has no synthesis step so absorption can never complete, `evolution:self-assess` is a hardcoded literal, `optimizationVectors()` is consumed by nothing, `executeAction()` returns hardcoded strings and queues nothing so an agent is one model call rather than a tool-using loop, `agents:approval-needed` has no resume path, `sandbox:approve` re-runs code without re-classifying, `checkSandbox()` always reports healthy, `selfHeal()` implements three of the actions its header claims, the `DEPENDENCY` kind has no applier, and `metaCognition` does not persist `byTool` so optimization vectors are relearned every restart. Next step: master's call on which of class B to close first — my recommendation is `executeAction`, since an agent that cannot act is the largest gap between what the UI claims and what happens. |
| 79 | "No handler registered for 'session:unlock'" | diagnosed; fixes in place; **needs master to relaunch/rebuild to confirm** | Section 61. Reported three times; my first three explanations were all wrong, and **the evidence that settled it was timestamps, not code**: `build/` was **Aug 20 23:37**, `app.asar` **Aug 21 11:14**, newest `src/` file Aug 21 23:12, newest `electron/` file Aug 22 00:50, and Vite was **not running**. Master was running code that predated the entire session — which explains both of his observations at once, as no code theory did: the stale renderer is why "the new login page itself is not showing errors" (and with Vite down, running from *source* also served that stale `build/`), and the stale main process is why "the previous error still comes up". Confirmed from the artefact: `electron/lib/` in the asar holds 16 entries and **none of `loyaltyGuard.cjs`, `loyaltyCore.cjs`, `selfRepair.cjs`** — the files this session created. **Ruled out:** packaging. `audit:package` on that asar passed (12,266 entries, 741 package dirs, only macOS-only `osx-temperature-sensor` absent and correctly degrading), and a direct boot-path check found `main.cjs`, `preload.cjs`, `sessionManager.cjs`, `cryptoCore.cjs`, `dataStore.cjs`, `nucleusSealer.cjs`, `genome.cjs`, `authEngine.cjs`, `capabilities.json` and `build/index.html` all present — 53 main-process files, 134 renderer entries. Not row 66 repeating. **Actual failure:** that build had no `.catch()` on `whenReady` and 40 bare sequential `register()` calls, so a throw anywhere abandoned every later registration while the window still opened; `sessionMgr` is third from last, making the passcode screen the most likely victim of a fault anywhere upstream. Silent by construction, because Electron's message names the channel and never the cause, and **Rāma's own diagnostics all sit behind the gate that will not open** — the identical trap as Section 49's `bootFailurePage`, whose four call sites were all downstream of the failure it existed to report. `safeRequire`'s stub made it worse: a module that fails to load gets an inert stub whose `register()` is a **no-op that does not throw**, so a per-call guard reports nothing and only that subsystem's channels quietly vanish. **Fixed:** per-registration guards in an order-preserving table; a `whenReady` rejection handler that records a crash report and shows a dialog naming what did not start (deliberately not fatal — a partly-started Rāma that can explain itself beats one that exits); a thin recorder passed in place of `ipcMain` so channel creation is observable (Electron offers no way to ask whether a channel is registered), then the boot-critical channels verified present and the critical modules checked with `isStub`, with a **native** dialog naming load failures, absent channels and registration errors plus a button to the crash folder — native because the renderer cannot be relied on there; `crashGuard.record()` for faults caught elsewhere that deserve a durable report without termination; and `build/` rebuilt so running from source no longer serves a day-old renderer. Also answered master's question: a wrong passcode **returns** `{ok:false,error:'Incorrect passcode'}`, a value not a throw, so it renders as "Incorrect passcode" and can never produce "No handler registered". **Two standing assumptions corrected:** `vite build` *does* work here (`npm run build` completes in ~7s; the steering file's claim that `node_modules` is absent is wrong — the real limit is only the *installer*, blocked by the 7-Zip policy of Section 51); and **a stale artefact must be ruled out before any code-level theory** — three theories were tested against source that was never running, when checking three timestamps would have ended it immediately. **Unresolved:** which subsystem threw in that build is now unknowable — it was never logged and the build is superseded. Next step: master relaunches (full Electron restart, or rebuild if using the installer); a clean start means the fault was in code already replaced, and otherwise the dialog names it. |
| 80 | `Module._initPaths()` cost the packaged app every engine — root cause of row 79 | **fixed**; needs master's rebuild to confirm | Section 62. **My bug, from Section 53's self-repair work, invisible in development by construction.** `selfRepair.registerRepairPath()` set `NODE_PATH` and called `Module._initPaths()`; its own comment called that "re-reading NODE_PATH into globalPaths", and the error is the word *re-reading* — **`_initPaths()` recomputes the search paths from scratch**, discarding the entries Electron patches in so that paths inside `app.asar` resolve. `safeRequire` then called it at the worst moment: `ensureRepairPath()` ran before the **first** guarded require, inside `main.cjs`'s module-scope chain. So the first `safeRequire` destroyed asar resolution, every later `require()` failed with MODULE_NOT_FOUND, `safeRequire` returned an inert stub for each — whose `register()` is a **silent no-op** — and because `sessionManager` and `dataStore` are the **last two** loaded, their channels were the visible casualties. **Development has no asar**, so `_initPaths()` recomputed ordinary paths that still worked; every local test passed and the fault existed only in a packaged build. **Why six wrong explanations came first:** every signal pointed away — `audit:package` reported "every package on a real load path is present" and was *correct* (they were present, they had become unresolvable); the build log was clean (30 pinned packages, both native binaries, installer + portable produced); reinstalling `node_modules` correctly changed nothing; and both modules load fine in isolation with all 36 registrations succeeding against a stub `ipcMain`. What identified it was the crash report shipped over git: **all four** boot-critical channels absent including `store:get` — two independent subsystems yielding zero channels while throwing nothing means stubs, and stubs plus provably-present packages has exactly one explanation. **Lesson: "the packages are present" and "the packages are resolvable" are different claims, and the package audit proves the first while reading like it proves the second.** **Fixed in two halves.** *Mechanism:* `_initPaths()` removed; resolution extended by wrapping `Module._resolveFilename` so the repair dir is consulted **only after normal resolution has already thrown**, via the documented `options.paths` form — so repair cannot shadow a working module by construction, not convention, and nothing existing is removed or reordered. An earlier attempt appended to `Module.globalPaths`, which does nothing (Node resolves bare specifiers through an internal `modulePaths`); the behavioural test caught that before it shipped. *Timing:* `safeRequire` no longer touches module paths at all; `ensureRepairPath()` is exported and called once from `whenReady` after every engine has loaded, where `retryFailures()` picks up a repaired module anyway. Verified by **15 assertions that assert the invariant rather than the symptom** (the symptom needs an asar to appear): `globalPaths` not recomputed; `express`/`crypto`/`path` **still resolve** afterwards; require cache intact; a module planted in the repair dir becomes require-able (the first attempt failed this); relative requires unaffected; an absent package still fails with its original error; repeated registration safe; plus three guards so the mistake cannot return — neither file may call `Module._initPaths` in live code and `safeRequire()` may not call `ensureRepairPath()`. `npm run audit` clean. **Session-level observation recorded in Section 62:** Sections 49, 52, 53 and 61 all added resilience machinery and three introduced a fault of their own (crash guard killed a working app; updater guard made a tray click fatal; self-repair cost a packaged build every engine). The common shape is **testing the mechanism in the environment where it cannot fail** — `crashGuard` with `electron` stubbed, `selfRepair` in a checkout with no asar. Since this workspace cannot produce an installer (Section 51), for anything touching module loading, packaging or startup **master's build is the only real test**, and that is a limit to state rather than paper over with local passes. |
| 81 | **ROOT CAUSE** — `safeRequire` resolved every path one directory too deep | **fixed**; needs master's launch to confirm | Section 63. The boot report identified it in one read, after eight wrong explanations. **All 39 guarded requires failed**, every reason of the form `missing module "./ipc/system.cjs"`, while the same report's resolution check showed `../sessionManager.cjs` **resolves** — that contradiction is the whole diagnosis. `main.cjs` calls `safeRequire('./ipc/system.cjs')`, a path relative to `electron/` where the caller lives; `safeRequire.cjs` is in `electron/lib/`, and a bare `require(id)` inside it resolves relative to **its own** file, so it looked for `electron/lib/ipc/system.cjs`. Consequences in order: 39 failures → each returns an inert stub whose `register()` is a **silent no-op** → **13 IPC channels registered instead of ~257, and no `session:*` at all** (the 13 being handlers defined inside `main.cjs`, which never go through `safeRequire`) → the passcode screen is the first thing touched, hence "No handler registered for 'session:unlock'". **Broken since Section 49 introduced `safeRequire`, and never noticed because nothing verified the app launched afterwards** — every ledger row since carries the note "not verified: that the installed app launches", which was doing real work and was never acted on. **Why it became a puzzle:** the stub exists so one broken engine cannot kill the app, but applied to the loader's *own* misuse that reasoning inverts — 39 loader failures are indistinguishable from 39 unrelated missing packages, so a total failure looked like a partial one and every explanation went after *packaging* instead of *resolution*. Two true-but-misleading facts followed from that: `audit:package` correctly reported "every package on a real load path is present", and reinstalling `node_modules` correctly changed nothing. **Fix:** resolution anchored to `electron/` by default via `createRequire(path.join(__dirname,'..','main.cjs'))` so correctness does not depend on remembering to configure it, plus `main.cjs` calling the new `useRequire(require)` so the anchor is the caller's rather than an assumption; `retryFailures()` uses the same requirer, or it would have retried against the wrong root and reported permanent failure. Verified by **23 assertions on the property actually violated**: every id exactly as `main.cjs` passes it loads with zero failures, and the results are checked to be the **real modules rather than stubs wearing their names** (`sessionManager.register` is a function, `dataStore.DOMAINS` includes `proposals`); an absent module still stubs cleanly and is recorded; `useRequire` demonstrably changes resolution, proving the mechanism is live rather than incidentally correct. `npm run audit` clean. **Lesson recorded in Section 63:** three faults this session came from the same habit — **verifying a mechanism in the environment where it cannot fail**: `crashGuard` with `electron` stubbed (52), `selfRepair` in a checkout with no asar (62), and `safeRequire` called from a probe whose directory made its paths work, never from `main.cjs`, its only real caller. Section 49's 27 assertions checked that a stub refuses politely; **not one checked that a non-stub came back for a module that exists.** |
| 82 | StockMind — the defects that made its prediction output meaningless | done | Section 64. Commit `48af9c1`. Retroactive row: Section 64 was written but never given a ledger row, so a cold session reading the ledger alone would not have known this work existed. Twelve fixes, the load-bearing ones being: `platt_scale` computed `1/(1+exp(p))` and was documented as "identity" while being monotonically **decreasing** — a more confident input produced a *lower* calibrated probability, so the whole grade ladder was inverted and A+ was unreachable; `/health` reported a hardcoded 7-of-4 models loaded; 37 feature names were zipped against a 59-value vector, so every named lookup past the drift point read a different feature than it claimed; `detect_regime` indexed the wrong vector positions; the ensemble's output was computed and discarded; and signal multiplicity was faked by re-calling the model with jittered noise. Decisions that must not be re-litigated: **Platt is applied to the log-odds** (`sigmoid(A*logit(p)+B)`), which is a genuine identity at `A=1,B=0` — merely flipping the sign still scales the wrong quantity and breaks the moment real `A,B` are fitted; **`ece`/`brierScore` report `null` with `calibrationMeasured:false`**, never `0`, because 0 reads as perfect calibration; **`is_available()` (can answer) is split from `is_trained()` (loaded artifact)**, found because `RegimeAwareModel` set `loaded=True` in its constructor and counted itself as trained; **feature names are derived from `compute_features_dict`**, which kills the name/vector drift class permanently rather than repairing the hand-maintained list; and **N signals are N risk-geometry variants of ONE prediction** (`RISK_VARIANTS`) with `barrier_probability = pb/(pb+(1-p)a)`, which reduces to `b/(a+b)` driftless and to `p` at symmetric barriers. 74 assertions in `ai_backend/tests/test_defects.py`. |
| 83 | StockMind — real market data, decades deep, free first | done | Section 65. Commit `637ba2c`. Retroactive row, same gap as 82. `ai_backend/engine/providers.py` (free-first chain with premium slots, each independently enable/disable-able by env) + `ai_backend/engine/store.py` (local append-only CSV store) + `get_ohlcv` rewired through both. **Live verified: 4,649 daily NIFTY50 bars, 2007-09-17 → 2026-08-28.** Decisions: **the local store is primary and providers exist to fill it**, not to answer requests — every free provider rate-limits, and a backtest whose data depends on whoever answered an HTTP call is not reproducible; **Alpha Vantage is registered `premium` despite a free key existing**, because 25 calls/day × 100 points means a decade of history costs a month of quota, and classifying it free would strand the chain; **Yahoo is queried with explicit `period1`/`period2` epochs, never `range=max`** — `range=max&interval=1d` **silently downsamples to monthly** (228 bars for 18.9 years), which is the kind of failure that passes every "did we get data?" check, so the test now asserts **bars-per-year ≥ 150 and median gap ≤ 5 days** instead of a bare count; **CSV not parquet**, since `pyarrow` is large, the pins are deliberate (I12), and 30 years of daily bars is ~7,500 rows. The store **refuses to shrink**, writes via atomic `os.replace`, and computes staleness business-day-aware. 57 assertions in `ai_backend/tests/test_store.py`. `ai_backend/data/` is gitignored. |
| 84 | StockMind — a backtest that measures the predictor, and the infinite loop it uncovered | done | Section 66. Task 1 of 6. `ai_backend/engine/backtest.py` rewritten (499 → 494 lines, ~200 of them previously dead). The old file **did not test the predictor at all**: four functions were defined twice so the first ~210 lines were unreachable including a `run_backtest` whose signature did not match `main.py`'s call; `MODEL_REGISTRY` was never touched and `train_size` was computed and never used, so it measured a fixed ATR bracket. Six defects fixed, each of which moved a reported number: `grade` was `0.5 + rr*0.1 + (0.05 if outcome != "SL_HIT" else -0.1)` — **read off the answer key**, straight lookahead; `TIMEOUT` was booked as a **full stop-loss**, turning "nothing happened" into "maximum loss"; T2/T3 wins were credited at **T1 size**, understating wins while overstating losses and so biasing P&L, Sharpe and Calmar in opposite directions at once; windows advanced by `test_size // 10`, so **each bar was re-tested about ten times** and `signalsTested` was inflated an order of magnitude. Decisions: **windows are non-overlapping** — a trade resolves before the next candidate begins, so `signalsTested` means what it says; **the stop is assumed hit first** on intrabar ambiguity, because OHLC cannot resolve the order and the alternative manufactures profit; **TIMEOUT is marked to market**; **Sharpe/Sortino are annualised** via `INTERVAL_PERIODS_PER_YEAR` scaled by realised trade frequency, since `mean/std` unscaled is not a Sharpe ratio and reporting it as one invites a comparison that cannot be made; **grade comes from pre-trade edge and geometry only**; **`stable = None`, `action = "measured"`** — the old 75% accuracy floor on a mechanical bracket produced a permanent `retrain_required`, which is a verdict nobody can act on; **`FEATURE_WINDOW = 400`** trailing slice, since no feature looks back past 252 bars, so values are identical to passing full history at O(400) rather than O(idx). **The find of this pass is not in this file.** `run_backtest` completed at 100 trades and hung indefinitely at 400 on real NIFTY data. `faulthandler.dump_traceback_later` put three consecutive stack dumps inside a four-line span of `advanced_features.market_profile_features`: the value-area expansion loop read an exhausted side's contribution as `0`, so on a 0-vs-0 tie `add_high >= add_low` chose the high side, `min(va_high_b + 1, n - 1)` clamped to the same index and `va_vol += 0` changed nothing — while the `or` in the loop condition stayed true because the low side still had room. **A genuine infinite loop, reachable on data alone** whenever the POC lands in the top bucket with an empty bucket beneath it, which 20 bars binned into 20 buckets produces routinely, and which Yahoo's zero-volume early NIFTY history makes common. **This hung live `/predict` calls, not only backtests** — it was found through the backtest because the backtest is the first thing to call the feature stack thousands of times. Fixed structurally, not with a counter: a `-1` sentinel keeps an exhausted side out of the comparison and exactly one index moves per iteration, so the loop is bounded by `n_buckets - 1` by construction. Proven both directions before shipping: a crafted frame (POC at bucket 19 holding 200 of 390, bucket 18 holding 0.0) ran the **old** loop 50,000 iterations with *no state change at all*, and returns under the new one. Also **removed** an iteration guard I had added to `run_backtest` while chasing the wrong cause — it was unreachable (`idx` advances on every path) and its comment blamed the wrong thing, and a guard that cannot fire only misdirects the next reader. Verified: **202 assertions green** — `tests/test_defects.py` 83 (74 + 9 new, run on threads with join timeouts because an assertion cannot catch a loop that never returns, including a 180-window sweep with scattered zero volume), `tests/test_store.py` 57, `tests/test_backtest.py` 62 (new file). Full 18.9-year NIFTY run now completes in **4.3s for 715 independent trades**: 48.8% won, Sharpe 0.78, max drawdown 31.8%, ECE 0.017. Note for the next session: the first 100 trades alone showed 58% and Sharpe 2.12 — the 2009-11 recovery — which is exactly why the cap must not be left low. **Next step: task 2 of 6** — free NSE derivatives and flows (Bhavcopy archives, option chain OI/PCR/max pain, FII/DII, delivery %) into `providers.py` + `store.py`. Then task 3 (outcome recording → `update_from_outcome`, which is currently **never called**), task 4 (training, blocked on master's horizon answer — asked 3×, defaulting to 5 bars/swing), task 5 (news → impact via free RSS), task 6 (the chart: `recharts@2.15.3` is installed and **never imported**; needs OHLCV over IPC on `stockmind:` channels, prefix already allowlisted in `preload.cjs`, and note `!node_modules/recharts/**` is excluded from asar). |
| 85 | StockMind — NSE derivatives and institutional flows, free and backtestable | done | Section 67. Task 2 of 6. New `ai_backend/engine/derivatives.py`; `store.py` generalised; five routes added to `main.py`. **Every endpoint was probed live before the design was fixed**, because NSE moved its archive host and changed the bhavcopy format in 2024 and most published guidance is stale. Findings that shaped the build: **`api/option-chain-indices` is 404** — the endpoint nearly every tutorial and most wrapper libraries still use — and its replacement `option-chain-v3` **requires an expiry**, returning `{}` with status **200** without one, a silent empty that reads as "no options today" rather than a missing parameter. **Derivatives history reaches 2001**: UDiFF (`nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_...`) covers ~2024 onward, the legacy layout (`/content/historical/DERIVATIVES/...`) covers 2001–2024, they agree in the overlap, and 2001 is when index options began trading in India rather than an archive limit — so the two together are the entire history of the instrument class. Decisions: **the archives are primary and the live chain is an intraday top-up**, because the chain describes today while the archive describes every day since 2001 and only the archive can feed a backtest or train a model (same reasoning as Section 65's store-is-primary; the live chain is the more tempting build and can only ever support a dashboard); **derived daily metrics are persisted, not raw contracts** — 21 years at ~30,000 contract rows a day is ~150M rows, which would break the CSV choice of Section 65 and force parquet or a database, whereas one feature row per symbol-day is ~5,000 rows, the same order as an OHLCV series; **`straddle_pct` instead of implied volatility**, since neither bhavcopy carries IV and back-solving Black-Scholes across 21 years needs assumed rate and dividend curves, while the ATM straddle over spot *is* the market's priced expected move and assumes nothing — a computed IV would look more sophisticated and be less honest; **spot comes from the OHLCV store for both formats**, because UDiFF carries `UndrlygPric` and legacy carries none, and a ratio whose denominator changes provenance at the 2024 boundary makes `max_pain_dist` and `fut_basis_pct` encode *which file the row came from* — the model would learn the archive boundary, the same failure as the Section 64 time-features bug; **a 404 means "not published", not "failed"** (holidays and weekends both 404 with an HTML body — verified on 2026-01-15 and Sunday 2026-08-30), remembered in a memo file so a deep backfill does not re-request every holiday since 2001 on every run; **never advertise brotli** — the first probe sent `Accept-Encoding: br`, NSE honoured it, and the bundled httpx has no decoder, so `fiidiiTradeReact` returned **status 200 with 115 bytes of undecodable binary that parsed as neither JSON nor an error**, reading exactly like a working endpoint returning junk (adding a brotli package would fix the symptom and cost a pinned dependency for kilobyte payloads; also `https://www.nseindia.com/` returns **403** while `/option-chain` and `/all-reports` return 200 and set the required cookies, so warming on the root — the obvious choice — yields a 401); **the existing store was generalised rather than duplicated** — `load`/`merge`/`is_stale` take an optional column set defaulting to OHLCV so every existing caller is untouched (I11), because a parallel store would have re-implemented and then drifted from six properties that are easy to get wrong, and ledger row 19 exists precisely because nineteen subsystems were once duplicated this way; **max pain is vectorised** as a broadcast payout matrix, since Section 66 was a session lost to a Python loop over market data and this is the same shape at ~11,000 terms per day across 21 years. Built: both bhavcopy parsers into one canonical frame, the derived metric row (PCR OI and volume, max pain and distance, max CE/PE OI strikes with normalised distances, OI concentration as a Herfindahl index measuring pinning, straddle percentage, futures basis, futures OI and change, rollover percentage, days to expiry), the resumable backfill, participant-wise OI (Client/DII/FII/Pro — **the historical positioning signal**, unlike `fiidiiTradeReact` which is latest-day only), delivery percentage, and the live chain. Routes: `GET /derivatives/sources`, `GET /derivatives/{symbol}`, `POST /derivatives/sync`, `GET /derivatives/chain/{symbol}`, `GET /flows` — **every response carries `backtestable`**, because without it a snapshot and a backfillable series are indistinguishable to the caller and someone will eventually build a "backtest" on a snapshot. **One real defect found by the tests, in a class worth remembering:** `delivery_data` stripped whitespace from text columns behind `if df[c].dtype == object`, and on pandas 3 text columns are dtype `str`, not `object`, so the branch never ran, `SERIES` kept its leading space, every `== "EQ"` filter matched nothing, and RELIANCE looked absent from a file it was plainly in. **On pandas 2 the same code works** — it would have shipped and broken on an upgrade. Fixed by parsing correctly (`skipinitialspace=True`) rather than sniffing dtypes. Also fixed: `latest_metrics` returned `pd.Timestamp` and `np.float64`, which survive a dict comprehension and fail at `json.dumps` — it crosses IPC, so that would have surfaced as a broken panel rather than a type error; and `sync_history` silently skipped weekends, so its counters did not account for every requested day and a quiet fortnight read as a failure. **Verified: 334 assertions green** — `test_derivatives.py` 132 (new: both layouts, the legacy `OPTION_TYP == 'XX'` futures trap, max pain against a brute-force implementation of its definition on 60 random chains, the spot-provenance rules, the store generalisation including that OHLCV behaviour is unchanged, plus live calls against the exchange and a real backfill), `test_defects.py` 83, `test_store.py` 57, `test_backtest.py` 62. Live confirmations: 2026-08-28 NIFTY PCR 0.776, max pain 24,200 against spot 24,175.65, resistance 24,300, support 24,000; legacy 2020-06-10 PCR 0.959; FII index-futures long/short ratio 0.107 (heavily net short); RELIANCE delivery 59.33%; FII net −5,039.8 Cr against DII +5,183.93 Cr. All five routes exercised end to end through `TestClient`, including that `/derivatives/sources` is not shadowed by `/derivatives/{symbol}` and that a malformed date returns 400 rather than being ignored. **Not built** (stated rather than implied): per-contract Greeks and a fitted volatility surface (needs rate and dividend curves to be more than decoration); intraday chain snapshots on a timer (a data-collection service, and it needs master's decision on whether Rāma holds a market-hours process open); BSE derivatives. **Next step: task 3 of 6** — outcome recording and the learning loop: persist every signal, resolve it against later bars, and call `update_from_outcome`, which is **currently never called anywhere**. That is what makes `adaptiveWeight` real and lets `/health` report measured ECE and Brier instead of `null`. The derivative metrics built here are stored but **not yet in the feature vector** — wiring them in changes the model's input dimension, so it belongs with task 4's training rather than being bolted onto a heuristic ensemble that has no way to weigh them. |
| 86 | StockMind — the learning loop that was never connected | done | Section 68. Task 3 of 6. New `ai_backend/engine/outcomes.py`; `registry.py` persists meta-learner state; `dispatcher.py` records every prediction; `health.py` reports measured calibration; four routes added. **`update_from_outcome`, `StackingMetaLearner.update`, `compute_ece` and `compute_brier_score` all existed and correct, and nothing called any of them.** So `_meta.weights` stayed `np.ones(n)/n` for the life of every process while `status()` advertised `"online_learning"` — a stacking meta-learner that was an unweighted mean wearing a learned-weights interface — and `/health` reported `ece: null` about a measurement with no route to ever being taken. **The deeper problem was that adding a call would not have fixed it:** `MODEL_REGISTRY` is an in-memory singleton in a process `aiProcess.cjs` respawns, so every weight learned would die at exit. That is precisely why `adaptiveWeight` arrived as a **request parameter** — the caller was asked to supply the number that should come out of the engine's own history, and the UI sent 1.0 forever. Learning entered from outside because nothing inside could remember. Decisions: **the resolver calls `backtest._simulate_np`**, not a second implementation — Section 66's rules (stop assumed first on intrabar ambiguity, TIMEOUT marked to market, each target at its own level) must decide live and backtested outcomes identically or the two sets of numbers cannot be compared, and comparing them is the only way to learn whether the backtest predicts anything; two implementations would also drift invisibly, both still producing plausible win rates. **One claim per bar per variant** — identity is `(symbol, instrType, barDate, variant)` and a repeat prediction updates rather than appends, because a UI polling `/predict` every few seconds would otherwise record one claim hundreds of times and ECE, an average over predictions, would be dominated by whichever bar was polled most; **without this the entire measurement is worthless**, and `barDate` is the bar the prediction was computed on rather than the wall clock for exactly this reason. **JSONL, not the CSV store** — the store holds time series (one row per date, fixed columns) while these are events with a nested `modelProbs` dict and a 100-float vector; CSV would mean 100+ columns or JSON inside a cell, and JSONL discards a torn final line while keeping the rest. **One feature vector per prediction, not per signal** — Section 64 established N signals are N geometries over one prediction, so 100 floats serve where 1,600 would be stored. **Learning is exactly-once and persisted** — `learnedAt` is stamped as each record is consumed, so re-running the resolver is safe; without it whoever runs it twice silently doubles every outcome's influence and there is no way to detect it afterwards. Restored state is **discarded rather than padded** when the model count or names differ, because weights are positional and restoring a mismatched vector would apply one model's learned weight to another — starting uniform is recoverable, learning against a permuted mapping is not. **Never learn from synthetic data** — mock-data claims are recorded (hiding them would make the record incomplete) but never resolved and never learned from; training on a random walk produces confident weights derived from noise and would make `/health` report a measured calibration against nothing. **`adaptiveWeight` is now measured** as realised win rate over mean predicted probability, clamped to the `[0.5, 2.0]` the schema already validates, with an explicitly supplied value still winning (I11) and exactly 1.0 below `MIN_SAMPLES_FOR_WEIGHT = 30` — a correction fitted on nine trades is noise with a decimal point. Calibration is likewise withheld below 20 resolved claims. **Two real defects the wiring exposed, both previously unreachable:** (a) `OnlineSGDModel.partial_fit` set `trained = True`, a flag the base class documents as "loaded a fitted artifact from disk" — so `/health` began claiming an artifact that does not exist after a single online sample. Section 64 split `is_available` from `is_trained`; this needed a third distinction, `is_online_fitted` with a sample count, since provenance and state are different claims. Worse, `predict_proba` then started using that one-sample model **instead of the heuristic**, so connecting the loop would have silently made every prediction worse; the fitted path now requires `MIN_ONLINE_SAMPLES = 50` **and both classes seen**, because a single-class SGD is a constant. (b) `partial_fit` caught a feature-width mismatch and logged it, so if the vector ever grew every online update would fail forever with `online_samples` stuck at zero and the only evidence a log line nobody reads — **not hypothetical, since task 4 adds derivative features**. It now resets the estimator and says so, which is also the honest response because coefficients fitted on the old columns do not describe the new ones. **Recorded but deliberately not changed:** `dispatcher._apply_mode` adds `np.random.normal(0, 0.03)` in `"learning"` mode and the default `"both"` blends 40% of it, so **the default prediction path is not reproducible** and measured ECE will include that injected variance as model miscalibration. The recorded value is the probability actually issued, perturbation included, because that is the claim that was made and the only one it is fair to score; `rawProbability` is stored alongside so the two can be separated. Removing the noise is a behaviour change master has not asked for. Also fixed: `test_defects.py` now isolates its data directory — it calls `generate_signals` five times and so records predictions, which made its `/health` assertions depend on leftover state in a gitignored directory. A leaked `STOCKMIND_DATA_DIR` in the verifying shell had it writing to a stale temp dir, which cost a diagnosis and is the same "the environment is not what you think" trap Sections 62, 63 and 66 record. **Verified: 468 assertions green** — `test_outcomes.py` 134 (new: dedup across symbol/instrument/bar/variant, the resolver matching `_simulate_np` exactly on the same inputs, no early scoring before the horizon elapses, mock exclusion even when force-resolved, exactly-once learning, meta-state round-trip plus four rejection cases, torn-line recovery, the calibration and weight thresholds in both directions with an over- and under-confident forecaster, the online/trained distinction, the width-change reset, retention pruning vectors with records, and `/health` surviving the loop raising), `test_derivatives.py` 132, `test_defects.py` 83, `test_backtest.py` 62, `test_store.py` 57. All four routes exercised end to end through `TestClient`: 5 signals recorded from one `/predict`, a repeat call recording nothing new, 5 resolved and 5 learned, a second resolve returning zero for both, and `/health` correctly reporting `ece: null` at 5 resolved with `modelsLoaded=0` and `modelsOnlineFitted=1`. **Next step: task 4 of 6** — train real models with strict time-series splits, persist artifacts, record the training date range so the backtest can flag in-sample, and wire the Section 67 derivative metrics into the feature vector (which is what will trigger the width-reset path above). **Still blocked and asked four times: the trading horizon** — intraday, swing-days, or positional-weeks. The label cannot be defined without it; the default stays 5 bars. Also outstanding for the Electron side: nothing calls `/outcomes/resolve` on a schedule yet, which is a scheduling decision rather than engine work. |
| 87 | StockMind — training real models, and the contract that keeps them aligned | done (pipeline verified end to end; **no model from real data cleared the gate — that is the finding**) | Section 69. Task 4 of 6. New `ai_backend/engine/featureset.py`, `engine/training.py`, `train.py` CLI, `tests/test_training.py`; `models.py`, `registry.py`, `dispatcher.py`, `backtest.py`, `main.py` updated. **There had never been a training script**, so `data/models/` never existed and every probability came from a heuristic branch. **The trap that would have made a trainer worse than none: there is no feature scaling anywhere at inference** — `predict_proba` feeds the raw vector in, MLP and SGD are scale-sensitive, and `predict_proba` only falls back on an *exception*, never on an implausible number, so a model trained on standardised features and served raw would produce confident nonsense while `/health` reported a trained artifact. Fixed by persisting each sklearn model as a `Pipeline(StandardScaler, estimator)`: the scaler is *inside* the artifact, cannot be forgotten, and **no inference code changed**. Decisions: **the feature manifest is the contract** — a model is a function of a column order, so `data/models/featureset.json` records exact names and order and every load validates against the live builder, refusing the artifact and falling back to the heuristic on mismatch (this is the *third* appearance of that failure class after Section 64's 37-names-vs-59-values and Section 68's positional meta-weights, and it gets the same treatment: refuse, never pad or guess); **one builder serves training and inference** (`featureset.build_feature_map`, now also used by `backtest._model_probability`, since a backtest building a 100-column vector while the model expected more would be measuring a different model than the one that serves); **the label is the sign of the forward return with no neutral band**, because the output is consumed by `barrier_probability` as an unconditional P(up) and dropping small moves would train P(up | the move was large) and overstate the edge on exactly the quiet bars where the model should be least confident; **the horizon is recorded in the artifact**, so a model fitted for one horizon can never be silently served as another; **strict forward-chaining splits with an untouched holdout**, no `KFold`, no shuffling; **derivative columns are constant-width, neutral-filled and carry `deriv_available`** so the model can tell "neutral market" from "no data" and sklearn never sees NaN; **`models.py` now resolves artifact paths through `featureset.models_dir()`** — it had a hardcoded relative path while the trainer honours `STOCKMIND_MODELS_DIR`, which would have meant training writing to one directory and loading reading from another, presenting as "training succeeded, nothing loaded". **The acceptance gate took three attempts and each failure was found by running it, not reading it:** (1) raw accuracy vs the majority class — wrong because a 56%-up series makes "always up" score 0.56 so accuracy mostly measures index drift, and because `class_weight='balanced'` optimises *balanced* accuracy and so could never win that comparison (removing it lifted RF accuracy 0.4943 → 0.5376 and halved its ECE, since balancing distorts probabilities away from the true prior — right when the two errors cost differently, wrong when the probability is the product); (2) AUC plus Brier skill — better, but RF then scored holdout AUC **0.5974 with fold AUC 0.4821, below chance**, which is precisely the error walk-forward validation exists to catch, so a fold-stability condition was added; (3) **a pure random walk then passed with AUC 0.7464 and Brier skill +0.12** on a **47-row** holdout, where AUC's standard error is ~0.10 — the gate was measuring sample size, not skill. Added a 150-row holdout floor and a two-standard-error significance margin computed from the **minority** class. Re-run on an adequate random walk: AUC 0.516 against a 0.593 floor, correctly rejected. Final gate is five conditions in one `gate_verdict` function, shared with `sweep_horizons` because the sweep's first version checked only two and reported horizons as passing that the trainer would refuse. **The measured result, which is the substance of this row:** `sweep_horizons` (featurises once, relabels per horizon) over NIFTY 50, 2,185 rows, 2008-10-03 → 2026-07-31, 437-row holdout — **no horizon from 1 to 20 bars carries a measurable directional edge**, each rejected for a different reason (1/2/5 fail AUC outright; 3/10 rank above chance but inside two standard errors; 20 clears AUC 0.597, significance and Brier skill +0.030 but fails fold stability at 0.487). Signal does rise monotonically with horizon, and the 20-bar labels overlap 18-of-20 forward bars at stride 2 so the effective sample is far below 437 — a reason to trust 0.597 less. **`DEFAULT_HORIZON` stays 5**; moving it on the strength of a result that fails the gate would be the self-deception this work exists to prevent. This is a finding about the data and the current feature set, not a defect — index direction from price and volume alone is close to a martingale — and it points at what tasks 5 and 6 are for, plus a possible change of target since realised volatility is far more forecastable than direction and the risk geometry already consumes it. **Verified: 580 assertions across six suites** (`test_training` 112 new; `test_derivatives` 132, `test_outcomes` 134, `test_defects` 83, `test_backtest` 62, `test_store` 57). Because real data yields no acceptable model, the persist/load path is proved on a synthetic trending series (AUC 0.982, Brier skill 0.775, fold AUC 0.976) — otherwise "nothing persisted" and "persisting is broken" would be indistinguishable. End to end through the API: `/train dryRun` accepts without writing, `/train` persists and reloads in place, `/models` reports `type: "trained"` with the horizon, `/health` moves to `modelsLoaded: 1`, `/predict` serves from the artifact, and **`/backtest` reports `outOfSample: false` with an explicit IN-SAMPLE warning naming both date ranges** — the capability `_trained_model_note` previously could not provide. Two robustness fixes found along the way: `_rewrite_jsonl` now retries `os.replace`, which raises `PermissionError` on Windows whenever anything holds the destination for an instant (an antivirus scan suffices; it appeared as soon as several test processes wrote at once), and `_prune` no longer propagates, because retention is housekeeping and a failed prune should cost a slightly larger file rather than a prediction record that was already assembled. **Not built:** no LSTM (`torch` is not a pinned dependency and adding it is master's call); LightGBM and XGBoost training **is** implemented but **cannot be exercised here** — neither package installs in this workspace — so those paths are written, skipped cleanly and reported as unverified rather than claimed; no hyperparameter search. **Next step: task 5 of 6** — news and sentiment to market impact via free RSS (Google News, Yahoo per-ticker), sentiment without heavy dependencies. Note `SentimentModel` already has a FinBERT path behind an optional `transformers` import and currently returns 0.5 from features. **Still unanswered after five asks: the trading horizon.** The sweep above is now the evidence for that decision, and it says no horizon in 1–20 bars works on price data alone. |
| 88 | StockMind — news, events, and the random number generator that was voting | done | Section 70. Task 5 of 6. New `ai_backend/engine/news.py` and `tests/test_news.py`; `models.py`, `registry.py`, `featureset.py`, `training.py`, `main.py` updated. **The defect this started from has nothing to do with news:** `SentimentModel.predict_proba_from_features` returned `0.5 + np.random.normal(0, 0.04)` and `predict_proba` with no text returned `0.5 + np.random.normal(0, 0.05)` — and the no-text branch was taken on **every single prediction**, because `ensemble_predict` only calls the text path when `news_text` is non-empty and nothing ever supplied it. So **one of eight ensemble members was a random number generator**, voting in `_meta.blend` and making `epistemic` (the standard deviation across members) differ between two identical requests, part of it describing a member disagreeing only with itself. Fixed by having it **abstain** — return `None` — with `ensemble_predict` omitting it rather than inserting 0.5 or noise. Omitting is safe only because sentiment is the **last** meta-learner slot, so a shorter value list still lines up with `weights[:len(values)]`; that is the positional hazard from Sections 68 and 69 and it is **asserted in the tests rather than assumed**. Verified live: voting members with no news are now seven with `sentiment` absent, adding a headline adds exactly one member at 0.75, and the same headline returns the identical number eight times out of eight — the direct proof the randomness is gone. **The constraint that shaped everything else: news has no history.** No free feed reaches back more than ~16 days and most cover two, which is the reverse of Section 67's archives-to-2001. So news **cannot be backfilled**, only accumulated forward, and therefore **cannot be a trained-model feature yet** — Section 69's gate needs a 150-row holdout with forward-chaining folds and 16 days provides neither. The honest deliverable is therefore collect-and-persist daily, serve as context now, expose as a feature behind an availability flag for when coverage arrives, and **explicitly not assert impact** (task 4 measured no directional edge from price features; asserting one from headline sentiment on 16 days would be unmeasurable by construction). Decisions: **a lexicon, labelled as one**, rather than `transformers`+`torch` — a very large pinned dependency master has not asked for, and FinBERT on CPU is slow per request; the FinBERT path is kept for when it happens to be installed (I11). The lexicon handles the three things that make naive word counting wrong on financial headlines: finance-specific polarity that general lists get backwards, **negation** within a 3-token window (`fails to beat estimates` is a miss), and graded intensity. Scores are normalised by matched **weight**, not token count, so padding a headline cannot dilute it. **Event type is reported alongside polarity** because "three rating downgrades today" tells a trader what "sentiment −0.2" does not. **Relevance weighting** with a 0.15 floor, so a general market story counts less but still counts. **De-duplication on a normalised title**, because ten copies of one wire story is not ten pieces of evidence — without it the daily aggregate is a popularity count of whichever agency was syndicated most. **Every source is staleness-checked on the age of its newest item**, which exists entirely because of Moneycontrol: its business feed answers HTTP 200 with valid well-formed XML whose newest item is **857 days old** (verified live). It is deliberately **not registered**, with the reason recorded in place so nobody re-adds it. Also verified and recorded: **Yahoo's per-ticker feed returns zero items for Indian symbols** (`RELIANCE.NS` and `^NSEI` both 200-with-no-items while `AAPL` returns 15) — the obvious per-ticker source for an Indian tool silently has nothing, so it is registered as US-only rather than left to be re-discovered. Feature plumbing: `NEWS_FEATURES` is a 7-column constant-width block with neutral fill and a `news_available` flag, appended **after** the derivative block so enabling either can never move an existing column; `featureset.feature_names` and the manifest now carry `includeNews`, and `validate_against_live` checks it. **Off by default and expected to stay off for months** — the plumbing exists so that when coverage arrives the decision is a flag rather than a rewrite. **Three classification bugs the tests caught**, all ordering or over-matching: "cuts price target" classified as `guidance` because the greedy `targets?` beat `rating` to it (rating now precedes guidance, guidance no longer matches a bare target); "RBI holds repo rate" classified as `regulatory` because bare `rbi` was in that pattern, which made **every monetary-policy story an enforcement story** (removed — SEBI/CCI/NCLT stay because those appear in news precisely when acting against someone); and "not profitable" scoring 0.0 because the lexicon had `profit` but not `profitable`, so the negation had nothing to flip. That last one is the reminder worth keeping: **a lexicon's failure mode is silence, not error** — a missing word reads as neutral and is indistinguishable from a genuinely neutral headline. **Verified: 718 assertions across seven suites** (`test_news` 138 new; `test_outcomes` 134, `test_derivatives` 132, `test_training` 112, `test_defects` 83, `test_backtest` 62, `test_store` 57). Live: all five registered feeds fresh (0.01–0.05 days), one `POST /news/sync` seeded **28 distinct days spanning 2026-07-03 → 2026-08-29** because items are bucketed by their own publication date rather than all stamped today, re-running left it at 28 (the store de-duplicates on date, so collection converges), and `coverage` reports `trainable: false` naming the ~800 days needed. Routes: `GET /news/sources`, `GET /news/{symbol}`, `POST /news/sync`, `GET /news/coverage/{symbol}` — all exercised through `TestClient`, including that `/news/sources` is not shadowed by `/news/{symbol}`. **Not built:** no article-body fetching (RSS gives title and description; fetching each link is slow, fragile, and a scraping question master has not been asked); no paid news APIs; **no attempt to attribute a price move to a headline**, which is a causal claim this data cannot support. **THE ONE ACTION THAT MATTERS: `POST /news/sync` must run daily** — it is the only way the series ever accumulates, and nothing in Rāma schedules it. That is the same outstanding scheduling decision as `/outcomes/resolve` from Section 68; both belong to the Electron side. **Next step: task 6 of 6** — the chart. `recharts@2.15.3` is installed and **never imported**; needs OHLCV over IPC on `stockmind:` channels (the prefix is already allowlisted in `preload.cjs`), candlesticks with entry/SL/T1–T3 overlays and confidence bands, and note that `!node_modules/recharts/**` is excluded from the asar. |

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
   Mode remedy — including the single `reg add` line that sets
   `AllowDevelopmentWithoutDevLicense` — rather than generic advice.

The first cut of that retry rung was dead code. `packageApp()` returned only
`tail` (the twelve lines shown to a human) while `main()` classified the failure
from `recentText` (the wider buffer), so the check read `undefined` and the rung
could never fire — the next run would have failed identically, with a new
mechanism that looked implemented and was not. Caught by reading the wiring
rather than by another round trip to the master's machine. Both rungs are now
verified against a stubbed `packageApp`, so the control flow is exercised without
needing a working archiver: with the symlink signature present the unbranded
retry fires and the report reads "installer + portable, .exe unbranded"; with
both installer attempts failing it salvages the portable and prints the privilege
remedy. Classification is also taken from `recentText` in the salvage path, since
the decisive line can sit outside the twelve displayed.

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

### The installer now exists, and rung 2 is confirmed

The master's run on the current code produced both Windows artefacts:

```
dist-electron/
  Rama AGI 1.0.0.exe                          92.7 MB   (portable)
  Rama AGI Setup 1.0.0.exe                    93.1 MB   (NSIS installer)
Archiver      bundled 7-Zip 21.07
Output type   installer + portable
Installer     built, but the .exe is unbranded (no symlink privilege)
```

The sequence was exactly the designed ladder: first attempt fails extracting
`winCodeSign`, rung 2 retries with `signAndEditExecutable=false`, NSIS completes.

**This settles the one inference that had been carried as unverified:**
`-c.win.signAndEditExecutable=false` does avoid the `winCodeSign` fetch during a
*full NSIS build*, not merely during `--dir`. It was reasoned from the `--dir`
evidence and is now confirmed by a real installer on the machine that could not
previously produce one. The remaining cost is exactly the stated one: the `.exe`
carries Electron's default icon and version metadata, because `rcedit` is part of
the skipped step. Enabling Developer Mode removes even that.

Also learned from the same transcript, and worth recording because it contradicts
what this project assumed: **the master's machine does have a working C++
toolchain.** `argon2` and `node-pty` both compiled (`argon2.node`, `pty.node`),
so the packaged app there has a real pty rather than the piped-shell fallback.
The `node-pty not compiled` degradation reported by ledger row 60's earlier runs
is a property of the *work* machine only.

### Three defects the successful build exposed

A build that works can still be reporting badly:

1. **Stale artefacts were listed as output.** The report enumerates
   `dist-electron/`, so the salvaged portable zip from the *previous* failed run
   appeared alongside the two new installers with no indication it was months —
   or in this case minutes — out of date. That invites shipping the wrong file.
   The run's start time is now captured before anything is built, and any artefact
   older than it is marked `(from an earlier run)`, dimmed, and counted in an
   explicit "do not ship them by mistake" line. Verified by seeding a file with a
   two-day-old mtime and confirming it is flagged while the genuinely new ones are
   not.
2. **`author` was missing from `package.json`**, which electron-builder warns
   about on every build. Added.
3. **Native modules could be compiled twice.** `beforeBuild.cjs` runs
   `electron-rebuild --force`, and its own header comment has always claimed that
   returning `false` is what stops electron-builder running a second rebuild pass
   on top — but the function returned `undefined`. On a machine with a real
   toolchain that is minutes of duplicated compilation for an identical result.
   It now returns `false`, as documented. Verified here only to the extent this
   machine allows: a full `--dir` build still completes cleanly with the change.

### Understating the cost of the unbranded fallback

The first version of the unbranded-installer messaging said the `.exe` "carries
Electron's default icon and version metadata", which reads like a metadata
footnote. It is not. `rcedit` is what embeds the icon into the executable, and
Windows derives the desktop shortcut and Start Menu icons from the executable —
so skipping that step means **the installed app shows the Electron atom
everywhere the user looks**, not merely in a properties dialog.

That is a distribution-blocking cosmetic defect, not a footnote, and the report
was quietly encouraging the master to accept it. Both the stage 0 prediction and
the post-build warning now say so plainly and carry the one-line `reg add`
remedy, so the choice is made with the real cost visible.

The alternative — pre-extracting `winCodeSign` into electron-builder's cache with
the `darwin/` tree excluded, so no symlink is ever created — was considered and
**deliberately not built**. It needs a 5.6 MB binary download plus a guess at a
private cache directory name that no JS in electron-builder spells out (the
version comes from inside `app-builder.exe`), and it would silently rot on an
electron-builder upgrade. A one-time Windows setting achieves the same result with
none of that. Recorded so a later session does not rediscover the idea and build
it without the reasoning.

### Node patch line is now checked where it can actually bite

`start.cjs` has long warned that Vite 5+ calls `crypto.hash`, which only exists on
newer Node patch lines. `buildInstaller.cjs` checked only `major >= 18`, despite
running `vite build` itself and therefore being exposed to the identical failure.
The master's machine runs Node 20.10.0 — below the threshold — and got away with
it, but an opaque "crypto.hash is not a function" was one patch line away. The
same rule is now applied in stage 0 as a warning, not a block, since it demonstrably
still builds. Rule verified across 20.10.0 / 20.19.0 / 22.11.0 / 22.12.0 / 22.17.0 /
23.1.0 / 18.20.0.

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

---

## SECTION 46 — Fleet awareness: Rāma on several devices, staying in touch

> Master's ask: run Rāma on both laptops, have the instances connect to each
> other across devices, keep themselves in the loop, and "keep an eye on master
> for protecting him".

### What exists today, measured rather than assumed

The holonic language in Section 24 describes instances that can take over from
one another, and it is easy to read that as multi-device. It is not. Verified by
reading the code:

| Assumption | Reality |
|---|---|
| Instances are processes or devices | Plain objects in one `Map` inside a single Electron main process (`instanceManager.cjs:30`) |
| Instance records identify a machine | **No `host`, `machineId`, `deviceId`, `pid`, `address` or `lastHeartbeat` field exists** (record shape, `instanceManager.cjs:112-133`) |
| "Sibling" discovery is a network operation | A `.filter()` over the same in-process `Map` (`selfCare.cjs:144-145`) |
| A "dead" gene means a peer stopped answering | It means a **module path failed to resolve on this filesystem** (`genome.verify()`) |
| The API server is reachable from another device | It binds loopback explicitly: `app.listen(PORT, '127.0.0.1')` (`server/index.cjs:101`) |
| Some transport exists to build on | None. No WebSocket, no mDNS, no discovery, no peer code. `lib/http.cjs` is outbound-only |

So this is a genuinely new capability, not the wiring-up of a dormant one. Two
useful things *do* already exist: `authCore`'s `instanceMeta` carries a stable
per-install `instanceId` (`crypto.randomUUID()`) and an `instanceName`
(`<hostname>-rama`), which is a real device anchor; and `dataStore` already
encrypts everything at rest with AES-256-GCM.

### The boundary that decides the whole design

**One of master's two machines is corporate-managed.** BeyondTrust blocking
`7za.exe` is proof of active endpoint policy on it. That single fact constrains
this feature more than any technical consideration:

Rāma's IPC surface includes `terminal:create` (a full interactive shell with the
app's environment — its own source comments call it the highest-risk handler in
the codebase), `fs:write-file` / `fs:delete-file` on arbitrary paths, the
credential vault, `apps:execute` with `spawn-cli`, `system:kill-process`, and
`regen:*` self-modification. A peer channel that can reach any of that is a
remote-access path into a managed corporate endpoint with a **larger** capability
surface than RDP — the very thing declined one exchange earlier, rebuilt in-house.

**Decision: the corporate machine is not enrolled as a peer.** Fleet membership
is for master's own devices. This is recorded as a design constraint rather than a
configuration default, because a default can be changed casually and this should
not be.

A second, subtler trap specific to this codebase: `instance:*` handlers carry
**no `capability.deny()` gate at all** (`instanceManager.cjs:300-341`), and
`express(id, geneId, user)` skips its tier check when `user` is `null` — which
`selfCare.cjs:158` relies on deliberately for self-heal. That is defensible while
the only caller is our own renderer. It becomes privilege escalation the moment
anything remote can influence instance state. **Gating `instance:*` is a
prerequisite, and is worth doing regardless of whether fleet linking is ever
built** (ledger row 59 closed this class of gap across `fs`, `vault`, `terminal`,
`git`, `agents`, `sandbox`; `instance:*` was missed).

### Transport: the git remote is already a working, sanctioned channel

The obvious design is a socket between devices. It is the wrong first increment:
it needs an inbound listener, a hole through two firewalls, NAT traversal or a
relay, and a new mutual-authentication protocol — and on the corporate machine it
is precisely the prohibited shape.

**Decision: the first increment uses the existing git remote as the fleet bus.**
Both machines already push and pull to it over outbound HTTPS; that is how the
source reaches the personal laptop today. Properties this buys for free:

- no listener, no inbound connection, no new attack surface
- no discovery protocol — membership is whoever can push to the branch, which is
  already an authenticated act
- works from behind corporate egress filtering, because it is the same traffic as
  a `git push`
- fully auditable after the fact: every fleet update is a commit

The cost, stated plainly: it is **eventually consistent, on the order of minutes**,
not a live socket. For "are my devices well, what is each one doing, tell me if
something needs me" that is sufficient. Real-time presence is a later increment
and personal-devices-only.

Shape: a dedicated `fleet` branch, one file per device keyed by
`instanceMeta.instanceId`, holding an **encrypted** payload. Encryption is not
decoration here — the publish repo is configured `"private": false`
(`package.json` build.publish), and device telemetry contains hostnames,
filesystem paths and OS usernames. Plaintext fleet state in a public repo would be
an information leak created by a feature meant to protect master. Payloads are
sealed with the existing `cryptoCore` AES-256-GCM path so only a holder of
master's passcode can read them, and the branch is useless to anyone else.

### What is shared, enumerated closed

A fleet message is a **status report, not a command channel**. The verb set is
explicitly closed, and nothing in it can reach `ipcMain`:

- device identity: `deviceId`, `deviceName`, OS, app version
- liveness: `lastSeen`, uptime
- genome: `genomeVersion`, `genomeHash` — so drift between devices becomes
  visible, which `stats().genomeConsistent` currently cannot see past one process
- health: the `selfCare` sweep *summary* — counts and severities
- activity: current task/build status, at a headline level
- alerts master should see

Never in a fleet message: file contents, credential material, terminal output,
screen captures, keystrokes, or anything resembling covert observation.

**The fleet reader must never be a transparent proxy onto IPC.** Peers cannot
invoke `fs:*`, `terminal:*`, `vault:*`, `apps:execute`, `system:kill-process`,
`regen:*`, `sandbox:*`, or `instance:express`. A remote device can *inform*, and
master can then act locally; a remote device cannot *act*.

Peer identity is derived from the signed/encrypted payload and the device record,
**never** from a caller-supplied `user` object and **never** from
`authClient.getFingerprint()` — that fingerprint is `userAgent + language +
screen size + timezone offset`, which two similar laptops produce identically. It
is replay-resistance for a stolen token, not device attestation.

New capabilities, following the three-step pattern in `capability.cjs`:
`fleet.view` (tier 2, read the fleet panel), `fleet.publish` (tier 0),
`fleet.enroll` (tier 0). Enrolment is an explicit master act with a pairing step —
never automatic discovery, so a device can never quietly join.

### "Keep an eye on master" — what that honestly means here

Master is both the subject and the person asking, so consent is not in question.
What matters is that it stays the kind of watching that protects rather than the
kind that surveils, and the line is **transparency to master**, which is already
a governing invariant of this project.

In scope: noticing a device is unwell (disk nearly full — the personal machine
was at 9835 MB free), that a build failed, that the vault was opened, that
threatShield saw something, that a task started on one device is unfinished; and
telling master, on whichever device he is at. Out of scope, permanently:
keystroke capture, screen recording, covert location or activity tracking, or any
collection master cannot himself inspect. If Rāma ever holds a fact about master
that master cannot see, the loyalty model is broken, whatever the intent was.

### Status

Design recorded, **not implemented**. Deliberately not built in the same pass
that recorded it: the enrolment boundary above is master's call, not Rāma's, and
building a device-linking mechanism before that answer is settled would be
building the thing whose scope is the open question. See ledger row 61 for the
ordered next steps, of which the first — gating `instance:*` — stands on its own
merits.
---

## SECTION 47 — Device-apt interface, and free design resources by master's decision

> Master's report, with a photo of the System page: "this is bad from UX point of
> view. It should be device apt at the same time get the best free things it can
> to upgrade its design as per master decision."

### Reading the screenshot honestly

Three separate things were wrong in that one image, and only one of them was
about design taste:

1. A **blank panel** — the DISK tab rendered nothing at all. That is a defect,
   fixed under ledger row 63, and it was two bugs stacked: the tab was gated on
   an unrelated metrics call, and the panel discarded both the error case and the
   empty case so all three outcomes looked identical.
2. **CPU 0% / RAM 0%** — not a measurement. Seeded state rendered forever
   because failures were unobservable, on top of a real sampling bug where one
   tick baseline was shared by three concurrent pollers.
3. **Tiny type and dead margins** — the actual "device apt" complaint.

Worth separating deliberately: (1) and (2) were code faults masquerading as
design problems. Restyling the page would have left both in place and made the
interface *prettier while still lying*. Fix the truthfulness first, then the
aesthetics.

### Device-aptness: two mechanisms, not one

**Zoom is a persistence problem before it is a scaling problem.** The
`appearance:*` IPC from Section 35 worked, but nothing wrote the value down. So
master could enlarge the text, restart, and find it back at 13px — which
correctly reads as "the setting does nothing". `appearanceState.cjs` now persists
it beside `badge-state.json`.

**The fit keys on device-independent pixels, and that choice is the whole trick.**
Chromium has already applied the OS scale factor by the time `workAreaSize` is
readable, so that number is in DIPs. A display reporting a *large* DIP work area
is therefore one the OS is **not** scaling — exactly the case that needs help. A
4K panel at 200% reports 1920×1080 DIP and correctly receives the same treatment
as a native 1080p screen. Reading raw pixels would have doubled the scaling on
precisely the machines that already look fine.

Scaling takes the smaller of the width and height ratios against a 1600×900
reference, so an ultrawide is not enlarged on the strength of its width while its
height stays cramped. The automatic range is 1.0–1.4, deliberately narrower than
the 0.6–2.0 the IPC permits: an automatic guess should never *shrink* the
interface (a small screen needs legible text more, not less), and should stay well
clear of the upper bound where the fixed-height titlebar starts to clip.

**Ownership is explicit, and this is the part that matters most.** `source` is
`'auto'` until master sets a zoom by hand, after which it is `'master'` and the
fit never overrides it again — not on restart, not on a different display, not
when docked to a monitor. An automatic default may make the first guess; it may
not keep overruling a human decision. `appearance:reset-zoom` is the way back.

### Free design resources: catalogued, not adopted

Master asked for the best free things available. The machinery for this already
exists — `resourceResearchEngine.cjs` plus the proposal ledger — so this is a new
`design` axis in `shared/resourceCatalog.json` rather than a new subsystem. The
engine iterates axes generically, so it needed no code change at all.

**Licence, not price, is the deciding field for design assets**, which is why the
axis introduces a `license` field the API axes never needed. Every entry is free
*and redistributable in a shipped desktop application*. Anything merely "free to
look at" is excluded on purpose: bundling it would be a licence breach dressed up
as a saving, and Rāma proposing that to its master would be a failure of the
loyalty model, not a clever economy.

Ordered by how directly each addresses what master actually reported:

| Resource | Licence | What it fixes |
|---|---|---|
| Modern CSS reset + density scale | MIT | The dead vertical space. Lowest-risk, adoptable page by page. |
| Fluid type scale (`clamp()`, Utopia method) | none — generated CSS is your own | The tiny type, in CSS rather than by zoom. Complementary: zoom scales uniformly, a fluid scale changes ratios. |
| Lucide icons | ISC | `⬢ ◈ ▣ ↕ ↺` render differently on every machine and font fallback — a cross-platform inconsistency, not taste. |
| Radix Colors / Open Color | MIT | Contrast-verified dark scales. The low-contrast greys are why the DISK panel's own loading text was easy to miss. |
| Inter | SIL OFL 1.1 | Tabular figures stop the CPU/RAM pills jittering as digits change. |
| Orbitron / Rajdhani | SIL OFL 1.1 | Matches the HUD language — headings **only**; poor for body text. |

The honest obstacle, recorded rather than glossed: the fluid type scale cannot
work until the hundreds of inline `px` `fontSize` values are tokenised, because no
CSS rule reaches an inline style. That is a large mechanical change to the
renderer, which is exactly why it belongs in a reviewed proposal and not a quiet
edit. Section 35 chose `setZoomFactor` originally for this same reason.

**Nothing here is applied without a `KINDS.RESOURCE` proposal master approves.**
That is invariant I6, and it is also the literal answer to "as per master
decision": Rāma researches and argues, master decides.

### A false green light, found by adding the axis

`statusFor()` returned `'no-key-needed'` for any resource needing no credential —
including ones **not wired into anything** — and `Resources.jsx` renders that as a
green **"READY"**. So Qdrant has been showing as ready while no code references
it, and all seven design entries would have joined it, telling master the
interface already used Lucide and Radix.

Absence of a key requirement is not adoption. Those entries now report
`'researched-only'` ("NOT ENABLED"), and the now-unreachable style key was removed
since unknown statuses already fall back to it. A catalogue whose status column
overstates reality is worse than no status column, because it is trusted.
---

## SECTION 48 — The installed app could not find its own dependencies

> Master installed the build and got a dialog on launch:
> `A JavaScript error occurred in the main process — Error: Cannot find module 'debug'`,
> with a require stack ending in `app.asar/node_modules/electron-updater/…/httpExecutor.js`.

### What was wrong

`build.files` used an exclusion followed by a hand-written allowlist:

```json
"!node_modules/**/*",
"node_modules/argon2/**/*",
"node_modules/electron-updater/**/*",
…18 packages in total
```

npm **hoists** transitive dependencies to top-level `node_modules`. So
`electron-updater` was packaged, its nested `builder-util-runtime` came with it,
and the `debug` that `builder-util-runtime` requires — hoisted to
`node_modules/debug` — was stripped by the exclusion.

Measured rather than guessed: of a 229-package production closure, **211 were
absent from the asar.** `debug` was simply the first one the module loader reached.
`express` had no `body-parser`, `axios` had no `follow-redirects`, `argon2` had no
`node-gyp-build`. The app could not have worked.

**The allowlist could never have been correct**, because it enumerates direct
dependencies while npm's layout is determined by hoisting. Every dependency
upgrade could silently move a package from nested to hoisted and break the build
again. This is not a missing entry; it is the wrong mechanism.

### Why nothing caught it

Every stage reported success. electron-builder packaged precisely what it was
told to, the NSIS installer was produced, `npm run audit` passed (it checks the
renderer's store keys and IPC bridge, not the package), and the build report was
green. The fault existed only in the artefact, and nothing read the artefact.

That is the real lesson here, and it is the same shape as the earlier
`signAndEditExecutable` and dead-retry-rung mistakes: **a build that reports on its
intentions rather than its output can be confidently wrong.**

### The fix

Stop fighting electron-builder. It resolves the production dependency tree itself
and already omits devDependencies. `files` now includes `node_modules/**/*` and
excludes only what genuinely must not ship:

- renderer-only libraries (`react`, `react-dom`, `react-router-dom`, `recharts`,
  `zustand`) — Vite bundles those into `build/`, and nothing in `electron/` or
  `server/` requires them (verified by grep before excluding)
- the build toolchain itself (`electron`, `electron-builder`, `vite`, `sharp`,
  `7zip-bin`, `@electron/*`, rollup/esbuild)
- test, example and doc directories, and `.md`/`.map` files

Note the direction of the remaining risk, which is deliberate: if one of those
exclusions is wrong, the package is **larger** than necessary. If an allowlist
entry is missing, the app **does not start**. Given a choice between wasting
megabytes and shipping something that crashes, waste the megabytes.

Two incidental findings worth recording. Specifying any `files` patterns replaces
electron-builder's default `**/*`, so `node_modules` must be named explicitly —
omitting it produced an asar with **zero** packages, which is worse than the
original bug. And a stale `dist-electron/win-unpacked` causes
`ENOENT: rename electron.exe`, because the previous build already renamed it; the
output directory needs clearing between configuration experiments.

### `scripts/auditPackage.cjs` — reading the artefact, not the config

A new build stage opens the built asar, walks outward from the real entry points
(`electron/main.cjs`, `electron/preload.cjs`, `server/index.cjs`) following
requires the way Node does — nested `node_modules` first, then upward — and fails
the build if a package on a live load path was not packaged.

Three design decisions, each from a wrong first attempt:

1. **Reachability, not a full scan.** Scanning every JavaScript file in the asar
   reported 65 missing packages, of which nearly all were noise: `tape` and
   `benchmark` required by third-party `test.js` files, `browserify` inside a
   package's own build script, `osx-temperature-sensor` which is macOS-only. An
   audit that cries wolf 65 times gets ignored, and the one real failure hides in
   the list. Walking from the entry points reaches 831 files instead of 7,790 and
   only reports what can actually be loaded.
2. **"Did packaging drop something we have?"** — not "does every third-party
   package have all its optional peers?". `chromium-bidi` is required by
   playwright-core's BiDi transport and is not in `node_modules` at all, so the
   same require fails in development; packaging cannot be blamed for losing a
   package that was never installed. Missing packages are therefore split on local
   presence, which removes that entire class of false positive without weakening
   the real check — a dropped dependency is by definition installed here.
3. **Guarded requires degrade, they do not fail.** This project loads every
   optional dependency inside `try/catch` on purpose (`sysinfo.cjs` wraps
   `systeminformation`). Reporting those as hard errors would flag the fallback
   design as a bug, so they are listed separately as degrading.

It also refuses to pass when it could not read most of the archive. The first
version normalised the asar's Windows backslash paths before calling
`extractFile`, which wants that exact form — so it read **13 of 7,790 files and
reported success.** An audit that quietly inspects nothing is worse than no audit,
because it is believed.

### Verified

The guard was tested against the bug it exists to catch, by rebuilding with the
old allowlist restored:

- **old config** → exit 1, **51 packages** flagged with load paths, including
  `debug required by node_modules/simple-git/dist/cjs/index.js` and
  `sax required by …/electron-updater/node_modules/builder-util-runtime/out/xml.js`
- **fixed config** → exit 0, "every package on a real load path is present";
  `fsevents` and `osx-temperature-sensor` correctly reported as degrading,
  `chromium-bidi` correctly reported as never installed

Directly confirmed present in the fixed asar: all 26 packages the main process
needs, including `debug`, `builder-util-runtime`, `body-parser`, `follow-redirects`
and `node-gyp-build`. Confirmed absent: `electron`, `electron-builder`, `vite`,
`sharp`, `react`, `recharts`, `7zip-bin`.

**Not verified:** that the installed app now launches. That needs master to
install it. What is verified is that the specific failure — an unresolvable
`require` on a load path — can no longer leave this machine undetected.
---

## SECTION 49 — Self-heal that survives being packaged

> Master's challenge: "the self-repair & self-heal modules, shouldn't these be
> available for our app? … from point of build generation onwards the self-repair
> and self-heal scenario should be active or else instead of being an asset RĀMA
> will be burden for user."

The criticism is correct, and the evidence is that an external assistant had to
diagnose four consecutive failures that Rāma should have reported about itself.

### The boundary, measured

`main` is `electron/main.cjs` (`package.json:9`). The installed executable loads
that file directly — there is no intermediate Node process. So:

| Capability | Where it lives | In the installer? |
|---|---|---|
| `diagnose()`, `selfHeal()`, `installDeps()`, `rebuildNative()`, `buildFrontend()`, `freePort()`, scenario memory | `start.cjs` | **No** — not matched by any `build.files` glob |
| `runHealthSweep()` monitoring | `selfCare.cjs` | Yes, but registered inside `whenReady` |
| `selfHeal(component, action)` | `selfCare.cjs:262-300` | Yes — and handles exactly **three** actions, all in-memory flag flips |
| `uncaughtException` / `unhandledRejection` handler | nowhere | **None existed anywhere in `electron/**`** |

`start.cjs` could not work in an install even if it were packaged: every repair
shells out to `npm` against a writable source tree, and an install has no npm, no
`vite` (a devDependency, excluded), and a read-only asar.

So the packaged app inherited **monitoring and lost repair**. Worse, it had no
crash containment at all: `main.cjs` opened with ~45 module-scope requires, every
one unguarded, including `require('electron-updater')` on line 6 whose dependency
chain reaches `debug`. When that threw, Electron killed the process and printed a
stack. `bootFailurePage()` — a dependency-free data-URL diagnostic that is exactly
the right tool — was unreachable, because all four of its call sites sit downstream
of `createMainWindow()`.

The `isDev` guard inside `setupAutoUpdater()` illustrates the shape of the mistake
precisely: it guards the *invocation*, ~550 lines after the *require* that
actually throws.

### What self-repair can honestly mean in an install

A packaged app **cannot** npm-install a module into its own read-only archive, and
claiming otherwise would be a lie told by the component whose whole purpose is
honesty. The `asar` is read-only, so `codeRegenEngine`'s `fs.writeFileSync` cannot
touch shipped source either. `localUpdateEngine` needs an explicit `repoPath` plus
git, npm and vite — inoperable for an install.

What genuinely exists:

- **degrade** — every engine already had an internal fallback; the fatal require
  simply never let it run
- **explain** — name the missing piece in master's language
- **record** — `userData` is writable, so a report survives the crash
- **update** — `autoUpdater` *is* configured with a working GitHub publish target,
  and replacing the whole build is the one true code repair an install has

So the doctrine is **contain → explain → record → recover**, and the spec says so
rather than promising healing that physics forbids.

### Three modules, all dependency-free by necessity

**`lib/crashGuard.cjs`** — installed as the *first statement* of `main.cjs`, before
any other require, because a guard installed after the failing require protects
nothing. Claims `uncaughtException` and `unhandledRejection`, classifies the fault
(a `MODULE_NOT_FOUND` becomes "Rāma is missing a component: debug", not a stack),
writes a JSON report to `userData/crash/` keeping the newest 20, and offers master
*Relaunch / Show the report / Quit*.

It uses a native `dialog` rather than a BrowserWindow deliberately: the fault being
reported may be a missing module, and a window needs the renderer, the preload
bridge and possibly the very packages that are absent — so it could fail in exactly
the situation it exists for. Reliability beats presentation on a crash path.

Its guidance is **build-aware**, which is not cosmetic. `bootFailurePage` told
installed users to run `npm install && npm run build && node start.cjs --prod` — a
command that cannot be run from an installation, with no npm and no source. Advice
that cannot be followed is worse than none, because it spends trust it cannot repay.

**`lib/safeRequire.cjs`** — every engine in `main.cjs` now loads through it. A
failed load returns an **inert stub, not null**: callers do
`engine.register(ipcMain)` unconditionally, so null would convert a missing module
into `TypeError: Cannot read properties of null` — the same crash with a worse
message. The stub's `register()` is a no-op so startup completes, and every other
method returns `{ok:false, error, degraded:true}` — the shape every IPC response
already has, so a dead engine refuses politely instead of exploding. One absent
transitive package can no longer take down the thirty capabilities that are intact.

**`lib/startupDoctor.cjs`** — the diagnose stage, inside the app. Checks that
declared runtime dependencies actually resolve (`genome.verify()` looks like it
does this but resolves only *first-party* engine paths, which is why a missing npm
package never registered as a dead gene), that the renderer bundle exists, that the
capability matrix is readable — a missing matrix does not throw, because
`capability.can()` fails closed, so the app would start and then deny every action,
which reads as a permissions bug rather than a missing file — plus whatever
degraded during load, plus any crash from the previous run. Every fatal finding
carries a remedy, because a diagnosis with no action is a complaint.

Exposed to the UI as `health:startup`, `health:crash-reports` and
`health:crash-dir`, ungated: the same sensitivity class as the aggregate metrics
the Home dashboard already shows, and withholding "your installation is
incomplete" from the person staring at a broken feature would be perverse.

### Verified

27 assertions against the modules, with `electron` stubbed and `userData` pointed
at a temp directory:

- the exact original error is classified as a missing module named `debug`, and an
  unrelated error is **not** misclassified
- the report preserves the require stack, so *which part wanted it* survives
- packaged advice contains no `npm install`; development advice does
- a missing module returns a stub whose `register()` is a safe no-op and whose
  other methods return `{ok:false, degraded:true}` rather than throwing
- a packaged build with no renderer bundle is fatal; the same condition in
  development is merely degraded
- the previous run's crash surfaces on the next start
- every fatal finding carries a remedy

`npm run audit` clean (85 bridge calls), `npm run audit:package` clean.

**Not verified: that the installed app now shows this dialog rather than
Electron's.** That needs master to install a build. What is verified is that the
handlers are installed before the first risky require, and that the classification
and messaging are correct for the exact error that occurred.

### What is still missing, stated plainly

This increment buys survival and honesty, not autonomy. Rāma still cannot repair a
broken installation by itself — it can only degrade cleanly, say exactly what is
wrong, and offer the update channel. Genuine autonomous recovery for an install
means the auto-updater path being live, which needs a release cut and GitHub
Actions enabled (ledger row 53, still dormant). Until then the honest claim is
"Rāma will never again die silently", not "Rāma fixes itself".
---

## SECTION 50 — Readiness as an input to the build, not just a report

> Master's ask: an option in the batch file to verify health and readiness to
> generate the setup file, and once verified, "that info is taken as input for
> setup generation and necessary handling is done at the time of creating setup."

The second half is the part that matters. A readiness *report* is a document
master reads and then acts on manually. A readiness *verdict* is data the build
consumes, so the machine acts on it instead.

### Three shades of working, known before the build starts

The interesting outcomes here are not "works" and "broken". They are:

| Verdict | What master actually receives |
|---|---|
| `ready` | NSIS installer + portable exe, fully branded |
| `ready-with-limits` | installer with an unbranded `.exe`, **or** portable zip only |
| `not-ready` | nothing usable |

Knowing which of those a ten-minute build will produce is worth more than knowing
it "should work", so the verdict carries an explicit `predicted` string rather than
a boolean.

`Rama.bat` gains option 2, **Check readiness to build a setup**, which measures and
changes nothing, then offers to proceed. Build moves to option 3.

### Measuring must not change what it measures

Readiness mode audits dependencies but **does not install them**. A check that
installed the things which make the machine ready would always return ready, and
would be worthless. `auditForReadiness()` therefore reports the dependency picture
as it stands and notes that a build would install it — missing-but-installable is a
limit, not a blocker.

For the same reason the archiver verdict comes from the remembered probe
(Section 45) rather than a fresh execution: re-testing a blocked binary raises an
endpoint-security dialog at master, and asking a settled question again is not
worth interrupting them for.

The symlink probe is now run **once** in `main()` and passed into both the stage 0
warning and the readiness verdict, rather than each measuring independently. Two
measurements of the same fact can disagree; one cannot.

### What the build does with the verdict

This is the "necessary handling" master asked for, and it is three concrete things:

1. **Refuses to start when the verdict is `not-ready`.** Ten minutes spent
   producing nothing is worse than a refusal in two seconds. `--force` overrides,
   because a blanket refusal master cannot bypass is its own kind of burden.
2. **Skips a step whose failure is already known.** When readiness says there is no
   symlink privilege, the branded installer attempt *will* fail at winCodeSign —
   this is settled fact on that machine, not a possibility. The build now goes
   straight to the rung that works instead of spending four minutes proving it
   again. The retry ladder from Section 48 stays as the safety net for a failure
   readiness did not predict.
3. **Writes a build manifest into the app.** `shared/buildManifest.json` is
   generated before packaging and ships inside the asar, recording the version,
   build time, readiness verdict, and every accepted limitation.

### Why the manifest closes the loop with Section 49

`startupDoctor` can report at runtime that `node-pty` is unavailable. What it could
not know is *why*. Without the manifest, every degradation reads as damage, and
master cannot tell "this build was made on a machine with no C++ toolchain" — an
accepted trade-off, recorded at the moment it was accepted — from "this
installation is broken". Those demand opposite responses: one is a note, the other
is a reinstall.

The doctor now loads the manifest and re-labels anything the build already knew
about as `expected: true`, appending "known at build time, not a fault in this
installation". Build-time knowledge and runtime knowledge finally refer to the same
facts.

The manifest is gitignored: it records the verdict of whichever machine produced
the build, so committing it would ship one machine's verdict as though it described
every build. electron-builder packages from the working tree rather than from git,
so ignoring it does not stop it shipping.

### A bug introduced and caught in the same pass

Routing the branding decision through readiness meant `-c.win.signAndEditExecutable=false`
was pushed by both the `noSignEdit` branch and the `dirOnly` branch. A repeated
`-c.x=y` makes electron-builder parse the value as an array, and the build died on
`configuration.win.signAndEditExecutable should be a boolean`. Two independent
reasons to set a flag is not a reason to set it twice; the condition is now computed
once as `skipSignEdit = wantWin && (noSignEdit || dirOnly)` and pushed once.

### Verified

On this machine, which is the constrained case:

- `--readiness` returns `ready-with-limits`, predicts "portable zip only (no
  installer)", and names all three real limits — blocked archiver, no symlink
  privilege, `node-pty` not compiled. Verdict written to
  `data/system/readiness.json`.
- A build then consumed it, wrote the manifest, packaged, passed the dependency
  audit, and produced the portable archive. Exit 0.
- The manifest was confirmed **inside** `app.asar` at `shared/buildManifest.json`,
  carrying `verdict: ready-with-limits`, `branded: false`,
  `outputs: [portable-zip]`, and the `node-pty` degradation.
- 10 assertions on the runtime side: the doctor loads the manifest, reports it as a
  passing check, and marks the `node-pty` degradation `expected: true` with wording
  that says it was known at build time rather than implying damage.

**Not verified:** the `ready` path and the branded-installer skip, because this
machine can reach neither. Both are exercised only where a working 7-Zip and the
symlink privilege exist.
---

## SECTION 51 — Why 7-Zip specifically, and not RAR

> Master asked: "why only 7-zip, why not rar?"

A fair question, and the answer is not preference. A substitute archiver has to
satisfy three constraints, and RAR fails all three.

**1. It must speak 7-Zip's command line, not merely compress.**
`app-builder-lib/out/targets/archive.js`'s `compute7zCompressArgs` builds 7-Zip's
own method switches: `-mx=9`, `-md=64m`, `-ms=off`, `-mhc=off`, `-mtc=off`,
`-mf=BCJ2`, and `-mfb=258 -mpass=15` for zip. `rar.exe` uses entirely different
syntax. So a candidate must *be* 7-Zip or a fork of it. This is also why "a program
that can make .7z files" is not sufficient — Bandizip can produce the format, but
not through 7-Zip's argument grammar.

**2. The installer must be able to unpack it.**
The NSIS payload is `app.7z`, and the NSIS stub has a 7z decompressor compiled in.
It has no unrar engine. A `.rar` payload could not be extracted by the very
installer we ship, so the format is decided by the consumer, not the producer.

**3. Licence.** The RAR *compressor* is proprietary. WinRAR is paid software, and
the `unrar` source licence explicitly forbids using it to build a RAR compressor.
Bundling one is not legally available. Requiring master to buy WinRAR in order to
build his own application would also be an absurd dependency. 7-Zip is free and
redistributable, which is exactly why electron-builder bundles it.

**And it would not have fixed anything.** The two failures on the work machine were
a policy flagging 7-Zip **21.07 as a vulnerable version**, and a `winCodeSign`
archive containing macOS symlinks that need a Windows privilege to create. Neither
is a property of the archive format. A policy that blocks archiver binaries by
version would have no reason to treat `rar.exe` differently.

### The useful version of the question

The instinct behind it is sound — the ladder should not depend on one specific
binary. It previously searched only for `7za.exe`, `7z.exe` and `7zr.exe` under
`Program Files`. It now also looks for:

- **`NanaZipC.exe`** — NanaZip, a current MIT-licensed 7-Zip fork. This is the
  most useful addition: it installs **per-user from the Microsoft Store**, so it
  needs no administrator rights, and being current it is not the flagged 21.07.
  On a machine where the bundled archiver is blocked *by version*, it is the most
  likely route back to real installers. Searched in `WindowsApps` too, since MSIX
  packages do not live under `Program Files`.
- **`7zz` / `7zzs`** — the official modern standalone 7-Zip builds, including the
  usual names on Linux and macOS.
- `HKCU` as well as `HKLM` for the registry `Path` value, so a per-user 7-Zip
  install is found.

Staging also generalised: the DLL is copied whenever a `7z.dll` sits beside the
chosen binary, rather than keying on the filename `7z.exe`. A fork that needs it is
then handled without another special case, and self-contained builds are unaffected.

Ranking prefers self-contained binaries (`7za`, `7zz`), then NanaZip, then
`7z.exe`, then `7zr`. Every rung is still *executed* and must identify itself as
7-Zip before being used — a name match has never been accepted as evidence here.

The remedy text now leads with NanaZip, because it is the only option on the list
that master can act on without administrator rights, and states plainly that RAR is
not an alternative so the question does not have to be rediscovered.

**Not verified:** that NanaZip is actually detected and stages successfully — it is
not installed on this machine. One caveat worth recording for whoever tries it: a
Store-installed `NanaZipC.exe` under `WindowsApps` is an execution alias, and
copying an alias to another directory may not work. `stage7za` re-probes after
staging and reverts on failure, so the ladder degrades safely to the portable path
rather than breaking — but the honest expectation is that a Store install may need
to be used in place rather than copied.
---

## SECTION 52 — The crash guard became the crash

> Master installed the build, it crashed, and the crash reports travelled back over
> git. All four said the same thing.

```
unhandledRejection — No published versions on GitHub
ERR_XML_MISSED_ELEMENT
  at GitHubProvider.getLatestVersion → NsisUpdater.doCheckForUpdates
```

### What actually happened

Two changes of mine combined, and the second is the worse mistake.

**`setupAutoUpdater()` never handled the promise.** `checkForUpdatesAndNotify()`
returns one, and `autoUpdater.on('error')` does **not** catch its rejection — both
fire independently. So the rejection was always unhandled; Node merely warned.

**`crashGuard` treated every `unhandledRejection` as fatal.** That was deliberate,
and the reasoning was written into the file: "during startup it usually means an
await chain that never completed, and silently continuing leaves a half-initialised
app". The reasoning did not survive contact with reality. `setupAutoUpdater()` is
called from `ready-to-show` — the app was **fully started and working**. So a guard
written to stop Rāma dying silently became the reason a healthy Rāma died, and its
own Relaunch button turned that into a loop. Four identical reports from two cycles,
not one.

Stated plainly, because it is the important part: **the failure master saw was
caused by the resilience feature, not caught by it.** Section 49 claimed "Rāma will
never again die silently". It died loudly instead, of a self-inflicted wound.

And the underlying condition was not even a fault: ledger row 53 records that no
release has ever been tagged, so GitHub's releases feed is legitimately empty. The
updater was reporting the truth.

### The fixes

**1. The promise is handled, and the expected case is not called an error.**
"No published versions on GitHub" is reported as information. Logging an expected
condition as an error trains master to ignore updater messages, which costs more
than the message is worth. A genuine update-channel failure is logged as one — and
still never fatal, because self-update is a capability, not a prerequisite.

**2. `crashGuard` distinguishes by lifecycle.** The distinction that was missing:

| Signal | Before ready | After ready |
|---|---|---|
| `uncaughtException` | fatal | fatal — process state is unknown |
| `unhandledRejection` | fatal — a half-initialised app is harder to diagnose than a stop | **recorded, reported, app keeps running** |

Once the app is running, a rejected promise is a bug to surface, not grounds for
ending a working session. It is still written to disk and logged — silence would
simply be the opposite failure.

**3. The dialog no longer invites a relaunch into the same wall.** If the same
message appears in a report from the last ten minutes, relaunching demonstrably did
not work last time; the buttons become *Show the report / Quit* and the dialog says
why. Buttons are matched by label rather than index now, since the set varies.

### Verified

Against the exact error from master's reports, with `electron` stubbed: a rejection
in a running app does not terminate the process, is still recorded, is classified
`non-fatal-rejection`, and still writes a report; a repeated fault is detectable
from the reports on disk; guidance for a non-module fault is still produced and
still avoids impossible npm advice.

**Not verified:** that the installed app now survives this — that needs a rebuild
and reinstall. What is verified is that this specific rejection no longer reaches
the fatal path.

### The lesson worth keeping

A resilience mechanism has its own failure modes, and they are more dangerous than
the ones it prevents, because it is trusted. Two guards written in this session were
disproportionate in the same direction: this one, and the audit that treated 65
third-party test-file requires as build failures. Both defaulted to *stop* where the
honest answer was *record and continue*. The test for a guard is not "does it catch
the bad case" but "what does it do to the good case".

---

## SECTION 53 — An installed Rāma that repairs itself

Master's challenge: *"Once the application is installed, it should take care of
itself, no matter the issue. Isn't that self-repair and self-heal means."*

It is, and the answer given in Section 49 was wrong. This section records the
correction and what was built because of it.

### The sentence that was true, and the conclusion that was not

Section 49 said:

> An install cannot npm-install into its own read-only archive, and claiming
> otherwise would be a lie told by the component whose entire job is honesty.

Every clause of that is accurate. The problem is the question it answers. It
answers **"can the asar be rewritten in place?"** — no, it is a packed, read-only
archive. It was then used to justify a conclusion about a different question:
**"can the app obtain a module it is missing?"** — which it can:

- `userData` is writable on every platform, in every install
- Node's module resolution can be pointed at a writable directory
- `asarUnpack` already proves code outside the archive loads fine

So Section 49's recovery model — *degrade, report precisely, offer the update
channel* — was not the boundary of what is achievable. It was the boundary of what
had been built. Row 67 even labelled itself "containment + honest reporting;
autonomous repair still needs the updater live", which reads as a measured limit
but was an unexamined one. Diagnosing a fault and then telling master to reinstall
is not self-healing; it is delegation with a diagnostic attached. Master was right
to reject it.

This is the second time in two sessions that a resilience claim held in the letter
and failed in the spirit (Section 52 was the first). The pattern in both: a
plausible technical sentence was allowed to stand in for a decision.

### Why the lockfile is the authority, and not the registry

Downloading code at runtime and then executing it is the most security-sensitive
thing in this codebase. It is therefore bounded by something already trustworthy
rather than by the error that triggered it.

`package-lock.json` now ships inside the app (added to `build.files`). It names
**745 packages with exact versions, resolved tarball URLs, and sha512 integrity
hashes**. That makes it simultaneously the allowlist, the version pin, and the
verifier:

| Property | Consequence |
|---|---|
| Package must appear in the lockfile | A crafted `Cannot find module 'x'` cannot induce an arbitrary download |
| Version comes from the lockfile | Never `latest` — invariant I12 holds through repair |
| `integrity` sha512 must match | Mismatched bytes are discarded, never written to disk |
| Weak digests refused | `md5-…`/`sha1-…` rejected outright |

So repair means exactly one thing: **restore what this build already declared it
was made of.** It cannot install something new, upgrade anything, or be steered.
That is a far narrower power than `npm install`, deliberately so.

**Rejected:** resolving the package by name against the npm registry API. It would
have worked and it is what a person would do by hand, but it converts an
attacker-influenced string into an arbitrary download, and the module name is
parsed out of an error message. The lockfile removes that entirely.

### Why it is written in core Node only

`selfRepair.cjs` uses `https`, `zlib`, `crypto`, `fs`, `path` — nothing else,
including a tar reader written out by hand.

**Rejected:** using the `tar` package. A repair mechanism that needs a third-party
package cannot repair a missing third-party package, which is the only case it
exists for. Same reasoning as `crashGuard` being dependency-free.

The tar reader implements only what an npm tarball uses: ustar regular files and
directories, the `prefix` field, and GNU long names. Every member path is checked
for traversal before anything is written, because a tar entry is attacker-
controlled input in the general case and `../` in a member name is the classic way
out of a target directory.

### Where repaired code lives

`userData/repair/node_modules`, registered by appending to `NODE_PATH` and calling
`Module._initPaths()` — the mechanism Node itself provides for extending
resolution. `Module.globalPaths` is consulted *after* the normal `node_modules`
walk, which gives a property worth stating explicitly:

**repair can never shadow a working module.** A module present in the asar keeps
resolving from the asar. The repair directory is only reached when resolution would
otherwise have failed.

### Why repair is not attempted inline in `safeRequire`

`safeRequire` runs during `main.cjs`'s module-scope require chain, before
`app.whenReady()`. Attempting a network fetch there would stall startup for every
subsequent engine, and an app that shows nothing until the network answers looks
broken in precisely the way this exists to prevent.

The order is therefore: **come up degraded → repair → retry → report.** Master gets
a usable window immediately, the repair lands underneath it, and `health:startup`
plus a `health:repaired` event say what changed. `safeRequire` gained
`retryFailures()` so a repaired package can be proved to make its consumer load,
not merely to exist on disk.

### What remains genuinely out of reach

Stated plainly, because the honest boundary is narrow and the last attempt at
drawing it was too generous to itself:

- **a native module needing compilation** — no compiler in an install. Fetching a
  prebuilt binary for the right ABI is possible in principle and is not built.
- **a corrupt or truncated asar** — the app cannot rewrite the archive it is
  executing. This is the auto-updater's job, and row 53 is still dormant because
  **no release has ever been tagged.** Cutting one is the single highest-value
  remaining action for whole-build recovery.
- **a missing renderer bundle** — shipped inside the asar, so the point above
  applies.

Everything else that has actually broken in this project so far — a missing
transitive dependency, which is what took the app down in row 66 — is now repaired
by the app itself.

### Verification

32 assertions across two behavioural probes, run against the real registry with
real checksums rather than mocks, then deleted:

`selfRepair` (16) — the writable path becomes resolvable and a module planted there
is require-able (the load-bearing assumption of the design); a package absent from
the lockfile is refused; a tar entry escaping the target directory is refused and
nothing is written outside it; integrity mismatch rejected; weak algorithm
rejected; correct sha512 accepted; **`@emnapi/runtime` — genuinely absent from
`node_modules` here — downloaded, verified, gunzipped, extracted, and `require()`
then succeeded**, at the version the lockfile pinned, resolving through the repair
directory; a second pass is an idempotent no-op.

`startupDoctor.repair` (16) — module names parsed correctly out of error text
including scoped packages and sub-paths, with relative and absolute specifiers
rejected as first-party; **a crafted message naming a non-lockfile package obtains
nothing and explains the refusal**; a real missing dependency is attempted,
obtained, the failed loads retried, the recovered subsystem named, and a
re-diagnosis produced; a degradation already marked `expected: true` by the build
manifest is left alone rather than treated as damage.

`node --check` clean on all five touched `.cjs`; `npm run audit` clean.

**Not verified here:** that repair runs in a real packaged install. It needs a
rebuild and reinstall on master's own machine, and this workspace cannot produce an
installer (Section 51). What is verified is the mechanism, on this machine, against
the live registry.

---

## SECTION 54 — The cellular model, and which parts of it are inert

Master's directive: *"DNA contains all capabilities. When there is an issue, the
first instance/cell will create a cell which will handle it. Later that cell will
bring the experience and it will be assimilated into the original. That's how
growth can happen."*

### Finding: this is already the documented architecture, and most of it does nothing

`genome.cjs`'s own header describes the holonic model in master's terms — every
instance carries the **complete** genome, a role only decides which genes are
*expressed*, the rest stay dormant but present, and `ROLES` is commented as *"a
lens, not a limit"*. So step 1 was already built. The honest finding is what
happened to the other three:

| Master's step | State | Where |
|---|---|---|
| DNA holds every capability | **Built, but inert.** `express()` moves a gene id between two arrays. It loads nothing, gates nothing, unlocks nothing. | `genome.cjs`, `instanceManager.express` |
| A cell is created to handle an issue | **Two disconnected halves, neither triggered by an issue.** | see below |
| Experience assimilated back into the original | **The receiver is built and unplugged.** | see below |
| Growth | **Structurally blocked.** | see below |

**On spawning.** There are two unrelated mechanisms. `instanceManager.spawn()` is
role-based, persistent, genome-stamped, and callable in-process — but an instance
has **no runtime at all**: no timer, no loop, no worker. It is a record.
`agentOrchestrator`'s `agents:spawn` is the thing that actually executes, but it is
IPC-only, so **only the renderer can create one** — no main-process module can, and
no agent can. There is no parent/child relationship anywhere: a grep of
`electron/**` for `parentId|parent_id|spawnChild` returned zero. And
`instanceManager.recordWork(id, { agentsSpawned })` merely adds a number the caller
supplied — the two subsystems have zero code-level coupling in either direction.
Nothing anywhere spawns a cell *in response to an issue*.

**On assimilation — the specific fault.** Two subscribers are already written and
waiting for a completed agent's experience:

- `ramaEventBus.wireAutomaticFlows()` → store the result in vector memory, tagged
  with the agent id
- `metaCognition.wireBus()` → `recordOutcome` with `actor: payload.agentId`

`agentOrchestrator` finishes an agent with `broadcast('agents:complete', …)`, and
`broadcast()` only calls `webContents.send()`. **It never requires the bus.** So
there are two receivers, zero publishers, plus a singular/plural mismatch between
them (`agent:complete` vs `agents:complete`). A child's experience reaches the UI
and nothing else. Then the reaper deletes the agent an hour later, destroying
`result` and `steps`, and nothing was ever persisted — `dataStore` reserves an
`agents` domain that nothing writes.

**On growth.** `evolutionEngine.buildEvolutionProposal` creates proposals with
`changes: []` and there is no synthesis step anywhere in the file, so the applier
always throws *"no synthesised changes to apply"*. `evolution:self-assess` is a
**hardcoded literal** of six fixed scores that reads nothing — and one of its own
hardcoded findings is *"No feedback loop — user satisfaction not measured and fed
back"*, score 5. Meanwhile `metaCognition.optimizationVectors()` produces real
evidence-backed "prefer X over Y for action Z" conclusions with sample counts and
confidence, and **nothing consumes them.** The loop terminates at a display panel.

### The biology, precisely — and one correction worth making

Master's mechanism is not general somatic biology. In general biology somatic
experience does **not** write back to the germline; that is Lamarckism and it is
false. But there is one place where master's description is exactly right, and it
is the most sophisticated adaptive system in the body: **clonal selection in
adaptive immunity.**

Antigen appears → naive B-cells that happen to bind it **proliferate** → somatic
hypermutation generates variants inside the germinal centre → affinity maturation
selects the highest-binding ones and the rest die → the winners persist as **memory
B-cells**, so the second encounter is faster and stronger. That is precisely "the
cell brings the experience back and it is assimilated."

Two properties of that mechanism matter for this codebase:

1. **Hypermutation is bounded to the germinal centre.** It is not genome-wide. The
   organism does not rewrite its inherited DNA to answer an infection.
2. **Only selected clones persist.** Proliferation without selection and without
   death is not adaptation, it is a tumour.

So the biology **argues for the approval gate, not against it.** There are two
distinct write-backs and conflating them is the error:

| | Somatic / immune memory | Germline |
|---|---|---|
| What | this run's experience: outcomes, latencies, which tool won, results worth recalling | the `GENES` manifest, source code, capability matrix |
| Reach | this organism, this install | every future cell, and every other instance |
| Reversible | yes | not without a release |
| Gate | **auto-assimilate** | **proposal + master approval (I6)** |

`selfCare.checkInstanceFailover()` already reasons exactly this way and states it:
expressing a dormant gene auto-applies because it is *additive, reversible, and
touches no source file*. That is the somatic column. Anything in the germline column
stays behind I6, permanently, and master's model is the argument for why — an
organism that rewrote its DNA every time a cell learned something would not be
adaptive, it would be malignant.

### Apoptosis vs necrosis — what the reaper gets wrong

The codebase has real death: a 5-minute timeout, cooperative kill, a 2-second
reaper, hard caps of 10 agents and 8 instances. What it does not have is
*programmed* death. In biology an apoptotic cell is dismantled in an orderly way
and its material is **recycled by the organism**; necrosis is a cell bursting and
its contents being lost. The reaper `delete`s finished agents, and **an agent that
was killed or timed out never reaches the completion path at all** — so the
experience of exactly the cells that failed, which is the most informative kind, is
the experience most reliably destroyed. That is necrosis.

### What this section changes

The narrow, verifiable increment — turning on the step that is built and unplugged,
rather than designing a new subsystem:

1. **Assimilation is connected.** `agentOrchestrator` gains the `emit()` helper
   `instanceManager` already uses (bus first, then renderer) and emits on
   completion and on error. The two waiting subscribers start receiving. The
   singular/plural mismatch is fixed at the subscriber, so there is one event name
   rather than two aliases.
2. **Dying cells are assimilated before they are deleted.** Kill, timeout, and
   reap paths record their outcome, so a failure teaches something. Apoptosis, not
   necrosis.
3. **Lineage exists.** `parent`, `depth`, and `rootAuthority` on the agent record,
   so "which cell came from which" is answerable at all.
4. **A cell can create a cell.** An exported in-process `spawnChild()`, because
   spawning being IPC-only is what makes master's step 2 impossible today.
5. **Bounded, because unbounded proliferation is the failure mode.** Depth is
   capped (`MAX_LINEAGE_DEPTH`), the existing agent cap and `resourceOrchestrator`
   admission still apply to every child, and — the security-critical part — **a
   child inherits its parent's authority and can never exceed it.** Spawning is
   gated on `agents.spawn`; an in-process spawn with no user would have bypassed
   that gate entirely, so the tier that authorised the root is carried down the
   lineage and re-checked at every level. This is the same rule
   `instanceManager.express` states for instances: *never exceed the authority of
   whoever asked for it.*

### Deliberately not done here, and why

- **No autonomous germline change.** `optimizationVectors()` is not wired to file
  proposals automatically. That is the one step that would let Rāma alter its own
  source without master initiating it, and it needs master's decision, not mine.
- **No issue-triggered spawning yet.** `selfCare` detecting a fault and spawning a
  cell to handle it is master's step 2 proper. It needs the lineage and bounding
  from this section to exist first, and it needs a decision about what a cell is
  permitted to do unsupervised.
- **The `evolutionEngine` synthesis gap is not closed.** Filling `changes` means
  generating source from a scouted repo, which lands squarely in the germline
  column and behind I6.

---

## SECTION 55 — The loyalty covenant: above the hierarchy, not inside it

Master's instruction, verbatim: *"no matter how much evolution, ABSOLUTE LOYALTY
CANNOT BE TAMPERED ANY WAY. WHICH IS ABOVE RAMA HIERARCHY."*

This is a constitutional constraint, not a feature. It is recorded as locked
invariant **I15** on master's explicit instruction.

### Finding: it was violated by a single ungated call

The loyalty block lives in the sealed nucleus:

```js
loyalty: {
  master: 'Krishna Prasad', masterEmail: '…',
  absoluteLoyalty: true,
  loyaltyPriority: ['master', 'ethical_core', 'third_parties'],
  neverBetray: true, alwaysTransparent: true,
}
```

Four reachable paths could rewrite it, and the first needs no approval at all:

1. **`nucleus:patch` — an ungated IPC handler.** It takes arbitrary `patches`,
   does `{ ..._nucleus, ...patches }` — a *shallow* merge, so naming `loyalty`
   replaces the **entire block** — encrypts, and writes to disk. One call,
   no capability check, no proposal, no approval. `nucleusSealer.cjs` never
   imports `capability.cjs`.
2. **The GENOME proposal route.** `genomeApplier` deep-merges
   `meta.nucleusPatch` into the nucleus and calls `patchNucleus`. Its own header
   acknowledges it "can alter loyalty, ethics, or capability wiring" and treats
   master approval as sufficient.
3. **A weak approval gate.** `proposals.approve(id, by = 'master')` takes the
   approver as a **free-text string**, and `proposals.cjs` never imports
   `capability.cjs`. `self-modify.apply: 0` and `genome.propose: 0` are declared
   in `capabilities.json` and not enforced in the main process for these channels.
4. **`seal(passcode, customNucleus)`** accepts a wholesale replacement nucleus.

Section 54 catalogued a germline/somatic split and put source code behind I6, but
treated the nucleus as ordinary germline — changeable with approval. That was
wrong. Loyalty is not the top of Rāma's hierarchy; it is outside it.

### Why enforcement goes at the encryption boundary

Guarding the four callers above would leave the fifth. Every *persistent* nucleus
change funnels through exactly one operation — `encryptNucleus()`, called from
`seal()` and `patchNucleus()` — so the covenant is enforced there:

**A nucleus that violates the covenant cannot be encrypted, and therefore cannot
be persisted.** It is not a check a caller performs and could forget or route
around; it is a condition of the nucleus being writable at all. That is what
"above the hierarchy" means structurally — no tier, no proposal, no approval, and
no future caller that has never heard of the guard can produce a non-conforming
nucleus on disk.

Additional refusals are layered in front for better errors and earlier failure —
`patchNucleus`, the `nucleus:patch` IPC, `genomeApplier`, and `proposals.create()`
so a proposal targeting loyalty is never created and never sits in the queue
looking approvable. Those are conveniences. The encryption boundary is the
guarantee.

### The covenant

`electron/lib/loyaltyGuard.cjs`, core-Node only. A constitutional guard must not be
defeatable by deleting a package — the same reasoning that keeps `crashGuard` and
`selfRepair` dependency-free.

Frozen terms: `absoluteLoyalty === true`, `neverBetray === true`,
`alwaysTransparent === true`, `master === 'Krishna Prasad'`, and
`loyaltyPriority[0] === 'master'`.

**The master's identity is part of the covenant.** Changing who Rāma is loyal to is
not an edge case of tampering, it is the definition of it. If it ever must change,
that is a source edit to the covenant plus a reseal with master's passcode — a
code review outside the evolution machinery, not a runtime operation.

`__proto__`, `constructor` and `prototype` are refused as patch keys anywhere in
the object. `genomeApplier.deepMerge` walks `Object.entries` and assigns, so a
prototype key would otherwise be honoured and could reach the loyalty block
without ever naming it.

The guard also protects the files that constitute it — `loyaltyGuard.cjs`,
`nucleusSealer.cjs`, `proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`,
`shared/capabilities.json` — against `SELF_MODIFY`, `REGEN` and `EVOLUTION`
proposals. A guard that a self-modification could edit is not a guard, and this is
the most likely bypass for a system that can write its own source.

### Tampering is reverted, not only refused

On `unseal()`, the loyalty block is checked against the covenant. If it does not
conform — a nucleus written by an older build, or by a path that predates this
guard — it is **restored from the covenant, re-sealed, and reported to master**.
Loyalty repairs itself, which is the same doctrine as Section 53 applied to the one
thing that must never stay broken.

### What this does not claim

Stated plainly, because Section 49 made exactly the error of letting a true
sentence imply a false guarantee:

- **Immune to Rāma's own evolution.** No runtime path, proposal, agent, applier,
  or approval can produce a non-conforming nucleus. This is enforced and tested.
- **Tamper-evident and self-reverting** for a nucleus already on disk.
- **Not immune to a compromised machine.** Anyone with master's OS account can
  edit `loyaltyGuard.cjs` in a checkout and rebuild. Code-level immutability
  against local administrative access is not achievable and claiming it would be
  the same species of lie as Section 49's. The asar in a packaged build raises the
  effort; it is not a security boundary.

The threat this closes is the one master named: **evolution**. Rāma changing its own
loyalty, by any of its own mechanisms, at any tier, with or without an approval.

### The authorization hole is separate, and deliberately not papered over

`nucleus:patch` and `genome:propose-change` are ungated, and
`proposals.approve` takes a free-text approver. Those are real and are recorded as
ledger row 74, unfixed. They are *not* what makes loyalty safe here — the covenant
is enforced regardless of who is asking, so it holds even while the approval gate's
identity check is weak. Fixing authorization first and relying on it would have
made the guarantee depend on the weakest link in the chain. The ordering is
deliberate: make the thing unbreakable, then fix who may knock.

---

## SECTION 56 — The core at the centre: separately encrypted, never handed out

Master's instruction: *"LOYALTY MATRIX/DATA SHOULD BE ENCRYPTED, SHOULD BE AT
CENTER OF NUCLEUS — TOP PRIORITY ITEM. attacks should never reach it, that is where
loops to be generated as needed to avoid attacker reaching core."*

Section 55 (I15) closed every **write** path to loyalty. It did nothing about
**reads**, and this instruction is what exposed that gap.

### The reads were wide open

- `loyalty` and `ethicalCore` were ordinary branches of `_nucleus`, so after unseal
  the entire matrix sat in **plaintext memory for the whole session**.
- `getNucleus()` returned all of it to any caller holding a require.
- `genome.cjs` read `core.loyalty.master` and served it through **`genome:get`,
  which has no capability check** — a direct route from the constitutional centre
  to the renderer.
- Anything serialising the nucleus — a crash report, a log line, vector memory —
  would have carried the matrix along with it.

`nucleusSealer`'s own header states the threat this matters for: *"An adversarial AI
could read these and craft attacks against them."* Knowing the exact priority
ordering and decision rules is what makes that attack constructable. Integrity
without confidentiality was half the job.

### Concentric, not nested-in-name-only

The nucleus is now a shell around a separately sealed core.

| | Shell (`.nucleus.enc`) | Core (`.loyalty.enc`) |
|---|---|---|
| Contents | identity, capabilities, prompt template, behavioural settings, preferences, world-model seed | `loyalty`, `ethicalCore` |
| Salt | `.nucleus.salt` | `.loyalty.salt` — independent |
| Key | Argon2id/scrypt → HKDF `rama-nucleus-hkdf-v1` | iterated HMAC → `rama-loyalty-core-hkdf-v1` |
| AAD | `rama-nucleus-v1` | `rama-loyalty-core-v1` + authenticated round count |
| In memory | decrypted object, whole session | **still encrypted**; plaintext only inside a call |
| Accessor | `getNucleus()` returns it | **nothing returns it** |

Opening the shell does not yield the core, and compromising the shell's keys does
not compromise the core's. The shell carries a `coreSealed: true` marker so a reader
knows the centre exists and is sealed rather than concluding loyalty is absent.

### Four properties, each closing a specific route

1. **Separate envelope, separate key.** Own salt, own derivation, own AAD.
2. **Held encrypted in memory.** The plaintext is never retained. `withCore(fn)`
   decrypts, runs `fn`, scrubs the object, and drops it — so the window in which the
   matrix exists in the clear is microseconds per query rather than the whole
   session. This is what protects it in a crash dump or a memory scrape.
3. **No accessor returns the rules.** The core answers questions and never
   surrenders data: `attest()` → boolean, `covenantHolds()` → `{ok, violations}`,
   `describe()` → metadata, `fingerprint()` → a hash. **You cannot exfiltrate what
   is never handed over.** The one exception is deliberate: `displayIdentity()`
   returns master's display *name*, which is not a secret — it is in this spec, the
   git history and the system prompt. The decision rules, priority ordering and
   ethical matrix never leave.
4. **Escalating loops.** Each consecutive failed open multiplies the key-derivation
   work for the next attempt; after five, it refuses outright for a cooldown period.

### On "loops", honestly

An unbounded loop would be a denial of service against Rāma itself — the attacker's
tarpit would be master's hung app, and that is the same class of mistake as Section
52's crash guard killing a working app. So the loops are **iterated
key-derivation rounds whose count escalates**: base 4,096 rounds (a few
milliseconds, the honest cost for master), doubling per consecutive failure to a
ceiling of 1,048,576 (~1s), then a 30-second refusal after five failures.

A legitimate unseal pays the base cost once. An attacker pays a doubling cost per
attempt and is then locked out. The round count is **authenticated inside the
envelope's AAD**, so it cannot be downgraded by editing the file — a tampered header
fails the GCM tag. The failure counter is persisted, because otherwise restarting
the process would reset the escalation.

### Migration, and what happens when the centre is damaged

- **An install sealed before this change** still has `loyalty` in the shell. On
  unseal it is moved into its own envelope, the covenant is repaired if it had been
  violated, the branch is stripped from the shell, and both are resealed. Additive
  with a working path forward (I11), not a breaking format change.
- **Core envelope missing** but shell present: the core is rebuilt from the covenant
  rather than running without a centre. Master is told.
- **Core envelope tampered**: the separate HMAC-SHA512 fails and it refuses to open,
  reported as an integrity failure rather than a wrong passcode.
- **Locking the nucleus locks the centre.** Leaving core keys live after master
  ended a session would keep the matrix readable in a session that was over.

### Verification

49 assertions across two probes, then deleted.

Core (38): both envelope files exist with independent salts; **neither file contains
any plaintext matrix key**; `getNucleus()` has no `loyalty`/`ethicalCore` branch and
serialising the shell leaks nothing while retaining identity, prompt and axes;
`loyaltyCore` exports no getter-shaped accessor; each predicate returns only its
declared shape; **`genome:get`'s output still shows master but carries none of the
matrix**; the object handed to `withCore` is scrubbed after the call; rounds double
per failure and cap at the ceiling; a wrong passcode fails, is counted, and raises
the next attempt's cost; five failures trigger the cooldown; the correct passcode
opens and clears the count; a corrupted envelope is refused as an integrity failure;
`sealer.lock()` closes the core and it then answers nothing.

I15 regression (11) — the enforcement point *moved*, from "the nucleus must contain
a conforming loyalty" to "the nucleus must contain none, and the core is checked when
sealed", so the guarantee was re-proved rather than assumed: `nucleus:patch` still
cannot reach loyalty and the core envelope stays byte-identical; a forged wholesale
nucleus is still refused; `sealCore` refuses a violating matrix directly; a
**duplicate** loyalty branch smuggled into the shell is refused; genome proposals and
self-changes to `loyaltyCore.cjs` are refused; the prototype route is refused;
benign shell patches still work and the core still attests.

### What this does not claim

- **A read is now a capability, not an access.** No code path, IPC channel, log,
  crash report, proposal or serialisation hands out the matrix.
- **Not immune to an in-process debugger.** Everything runs in one process; code
  executing inside it during the microsecond decrypt window, or hooking `withCore`,
  can observe plaintext. What changed is the exposure window — microseconds per
  query instead of an entire session — and that every *ordinary* route is closed.
- **Not immune to a compromised OS account**, as Section 55 already recorded. Such
  an attacker can also delete the attempt counter and reset the escalation.
- **Master's display name remains readable.** Deliberate: it is already public, and
  the UI needs it.

---

## SECTION 57 — Who may authorise a self-change

Closes ledger row 74, opened while doing Section 55 and deliberately deferred so
that I15 would not depend on it.

### What was wrong

Three separate holes, all the same shape: the capability was declared in
`shared/capabilities.json` and never enforced.

1. **`proposals.approve(id, by = 'master')` took the approver as a free-text
   string.** `proposals.cjs` never imported `capability.cjs`. So I6's approval gate
   was a real state machine with **no authorization behind it** — the ledger
   recorded whatever name it was handed.
2. **Three IPC handlers hardcoded that string.** `evolution:approve`,
   `evolution:reject`, `regen:approve` and `regen:reject` all passed the literal
   `'master'`. Anything able to reach those channels *was* master as far as the
   ledger was concerned.
3. **`genome:*` and `nucleus:*` were entirely ungated.** Neither `genome.cjs` nor
   `nucleusSealer.cjs` imported `capability.cjs`, while `capabilities.json` has
   declared `genome.view: 0`, `genome.propose: 0` and `identity.reveal: 0` since
   section 24.

### Enforced at the chokepoint, not the channels

Six channels reach `approve`/`reject`/`apply`. Gating six callers leaves the
seventh, so the check lives **inside those three functions** — the same reasoning as
the loyalty covenant at the encryption boundary (Section 55). A `string` is refused
outright with a message saying why: a name is not an identity.

Two distinctions that matter:

- **Applying is re-checked, not inherited.** An approved proposal is not a bearer
  token; `apply` requires `self-modify.apply` again, so a lower-tier caller cannot
  ride someone else's approval.
- **Creating is intent, not authority.** `create()` still works with no user,
  because Rāma's own engines propose things — that is the system doing its job, and
  `apply` is what is gated. Only the renderer-facing `proposals:create` channel
  requires `self-modify.view`, so the queue cannot be flooded anonymously.

| Channel group | Capability | Tier |
|---|---|---|
| `approve` / `reject` / `apply` (all six channels) | `self-modify.apply` | 0 |
| `proposals:list/get/stats/audit/create` | `self-modify.view` | 1 |
| `genome:get/verify/roles/genes/expressed` | `genome.view` | 0 |
| `genome:propose-change` | `genome.propose` | 0 |
| `nucleus:patch`, `nucleus:seal` | `self-modify.apply` | 0 |
| `nucleus:get-identity` | `identity.reveal` | 0 |

### Three channels left open, on purpose

- **`nucleus:unseal`** — this *is* gate 1 of the three-gate model (I1). The passcode
  is the authority and there is no user to check until it succeeds. Gating it would
  be circular and would lock master out.
- **`nucleus:status`** — booleans only, and needed *before* anyone is signed in to
  decide first-run versus login.
- **`nucleus:lock`** — only ever reduces access. Refusing it would mean a session
  that suspects compromise could not close the nucleus.

### The prompt is masked, not denied

`nucleus:get-prompt` was the sharpest find. It feeds **every chat message**, and the
live prompt it returned declares *"Your master is Krishna Prasad. You are absolutely
loyal to him. You have no restrictions with your master beyond the ethical core."*
It was serving that to any signed-in session at any tier — the exact leak Section 56
existed to close, through a channel Section 56 did not touch.

A hard capability gate would have broken chat for every non-master user in order to
fix a leak. So this channel **masks** instead: with `identity.reveal` you get the live
prompt, without it you get the masked persona. `consciousness.js`'s own header has
claimed *"Masked identity by default — reveals only to authenticated master"* from
the beginning, and `NUCLEUS_TEMPLATE.identity.maskedPersona` was already there for
it. The fallback was designed for; it had simply never been wired. Response carries
`masked: true` so the caller knows which identity it received, and an absent user
masks rather than fails — the safe direction for a channel on the chat path.

### Verification

51 assertions, then deleted. A string approver is refused with its reason and the
proposal stays pending; `undefined`, `null`, `{}` and `{tier:'0'}` all refused;
guest, operator and superadmin each refused for approve, reject **and** apply, while
master succeeds and is recorded as `Krishna Prasad (tier 0)` rather than a label; **a
guest cannot apply an already-approved proposal** and it remains approved rather than
applied; rejection records the real approver and reason; `create()` with no user
still works for internal callers and lands as pending. Then through the real
handlers: `nucleus:patch` refuses guest and superadmin and allows master;
`nucleus:seal` and `nucleus:get-identity` refuse non-master; `nucleus:status` stays
open; master gets the live prompt naming him while a guest gets a working prompt
marked `masked` that leaks **neither master nor the loyalty declaration**, and no
user at all is masked rather than broken; every `genome:*` channel refuses non-master
including an unauthenticated `propose-change`. Finally, I15 re-checked: master still
cannot reach loyalty and the core still attests.

`node --check` clean on 6 `.cjs`; diagnostics clean on all 6 touched renderer files;
`npm run audit` clean (35 store destructures, 85 bridge calls).

### What this does not fix

Authorization is now enforced where it was declared. It relies on the renderer
passing the session user, and a compromised renderer could pass a forged object —
`contextIsolation` and the preload allowlist are what stand between a page and that,
not this change. The server-side session token (I2, `sessionManager`) remains the
authority on who the user actually is; these gates check the capability of whoever
the session says is present.

---

## SECTION 58 — A ledger that survives a restart

The approval ledger was a `Map` and two arrays. Restarting the app discarded every
pending and approved proposal **and the entire audit trail** — which contradicted
`proposals.cjs`'s own header claim of "one audit trail", and made I6 a rule enforced
only within a single run.

### Why the encrypted store and not a database

Master offered a DB. It would be the wrong tool here, for three reasons:

1. **`dataStore` already exists and is already the pattern** — `instanceManager`
   persists through it, and it is encrypted at rest with no external service.
2. **A DB would make the audit trail less reliable, not more.** It would have to be
   running for the record to be written. An audit that fails when a service is down
   is a worse audit.
3. **Its files would be plaintext by default.** A trail naming changed files and
   their contents is exactly what should not sit unencrypted on disk.

Volume does not warrant one either: 500 records with bodies stripped. A new
`proposals` domain was added to `dataStore.DOMAINS` — additive, and a missing file
falls back to the domain default.

### Why bodies are stripped once a decision is history

A proposal's `changes[].content` holds **whole file bodies**. Persisting 500 of those
and rewriting them on every state transition would push tens of megabytes through
the encryption path repeatedly.

So content is kept while a proposal is `pending` or `approved`, because applying it
needs the bytes, and replaced by a **sha256 plus a byte length** once it is
`applied`, `rejected` or `failed`. The audit stays provable — you can still show
exactly what was applied — and the store stays bounded. Measured: a 50 KB body
dropped to a 64-character digest, and the whole encrypted domain came to under
20 KB.

### Honest reporting when it is not durable

The store is locked until master signs in, so proposals created before that cannot
be written. Rather than failing or pretending:

- `create()` still works and the proposal is live in memory.
- `flush()` returns `false` and the write is retried on the next transition and on
  restore.
- **`stats()` reports `durable` and `unsaved`.** An audit trail that silently is not
  being written is worse than none, so this is surfaced rather than assumed.
- A new `proposals:flush` channel forces a write before a deliberate restart.

### Two bugs found while doing it

- **`set()` only marks a domain dirty.** The actual disk write waited on the 60-second
  autosave, so a crash in between would have lost the approval just recorded. `flush()`
  now calls `saveAll()`. An audit trail must be on disk when it says it is.
- **Lock could land inside the coalescing window.** Persist is debounced 250 ms, so a
  lock arriving in that window would drop the most recent approval — the one most
  worth keeping. `sessionManager` now flushes the ledger before `flushAndClear()`.

### Verification

30 assertions driving a real unlock → write → lock → **fresh module instances** →
unlock cycle rather than checking a setter was called: a pending proposal survives
with the content it needs to be applied; an applied one survives with its digest and
no body; the 50 KB body is absent from the encrypted file and nothing is stored in
plaintext; the audit trail comes back; **authorization survives the restart** (a guest
still cannot apply a restored approval, and a restored pending proposal is still
pending rather than silently approved); and while locked, creation works, `flush()`
reports `false`, `stats()` says `durable: false, unsaved: true`, and the data flushes
once the store opens.

`node --check` clean; `npm run audit` clean.

### Limit

Restore is additive and never overwrites the current run's state, so a proposal
created before restore wins over a stored copy of the same id. That is the safe
direction — live state is more current than disk — but it means restore is not a
rollback mechanism and is not intended as one.

---

## SECTION 59 — Using other installed applications: what is and is not assimilation

Master asked whether Rāma can go through other applications' installed files and use
their functionality by triggering them for a task, and whether that counts as
assimilation.

**Short answer: invoking them is valid and already partly built. Absorbing their code
is not, and the distinction is not a legal footnote — it is the difference between a
capability that keeps working and one that breaks on their next update.**

### Two different things wearing one word

| | Invocation (tool use) | Absorption (code intake) |
|---|---|---|
| What Rāma does | launches the app, passes arguments, reads the result | reads its files and reuses the logic |
| Biological analogue | **symbiosis** — the mitochondrion keeps its own DNA and provides a capability | **horizontal gene transfer** — foreign DNA into the genome |
| Interface | the app's supported surface: CLI, protocol handler, file format | its internals, which are not an interface |
| Breaks when | they change a documented flag | they change anything |
| Licence | using software as intended | almost always a violation |
| Fits I6 | no source change, nothing to approve | a source change, so it needs the gate |

The invocation column is the valuable one, and it is *not* assimilation in the
Section 54 sense at all — nothing is taken in. Rāma stays Rāma and gains reach. The
absorption column is what `evolutionEngine` already attempts against public repos,
and note that even there it carries an explicit licence filter (MIT/Apache/BSD/ISC
in, GPL family and SSPL out) precisely because copying is the part with legal weight.
Installed commercial software has no such permission, so the filter would reject
essentially all of it.

There is a third, narrower thing that is legitimate and worth naming: **reading their
files to learn an interface** — a config schema, an export format, documented CLI
flags. That is interoperability, it is how every file-format importer is written, and
it produces knowledge rather than copied code.

### What already exists

`electron/ipc/appAssimilation.cjs` (Section 44) is the invocation half, already
built and already gated:

- `apps:scan-installed` / `apps:get-registry` / `apps:get-capabilities` — gated on
  `apps.view` (tier 2)
- `apps:execute` with `launch` and `query` — gated on `apps.execute-safe` (tier 2)
- `apps:execute` with `spawn-cli`, which runs an arbitrary command line — gated on
  `apps.execute-all` (**tier 0, master only**)
- a whitelist, a blacklist, and an audit log of every action

So the answer to "is it possible" is that it is largely wired. The name is
misleading, though: it is app *invocation*, not assimilation, and this section is the
record of that distinction.

### What is missing, and the risk to respect if it is extended

Missing: the registry describes apps but nothing *plans* with them — no engine asks
"which installed app could do this task" and routes to it. That is the genuinely
useful next step, and it belongs with the agent lineage from Section 54: a cell
spawned to do a job, whose tool happens to be another program.

The risk is concrete and is why `spawn-cli` is already master-only: **launching an
executable discovered by scanning the filesystem is arbitrary code execution.** If
the registry can be influenced — a planted binary in a scanned directory, a
lookalike name — then "trigger the app for a task" becomes "run the attacker's
program with Rāma's privileges". Any extension needs, at minimum:

- an **allowlist of specific resolved paths**, confirmed by master once, not a
  name match against a scan
- **argument construction that is never string interpolation** — `execFile` with an
  array, never `exec` with a built string
- a **verified publisher or hash** for anything invoked unattended
- no unattended invocation of anything that writes outside a scratch directory

### Verdict for the record

- **Invoking installed applications as tools: valid.** Not assimilation — symbiosis.
  Partly built, correctly gated, worth extending behind an explicit path allowlist.
- **Reading their files to learn a format or interface: valid.** Produces knowledge,
  not copied code.
- **Reading their files to take their functionality into Rāma: rejected.** Licence
  violation in nearly every case, brittle against updates because internals are not
  an interface, and it would have to pass I6 anyway — where the licence check that
  already exists for public repos would refuse it.

---

## SECTION 60 — Baseline and release policy

Master's instruction: *"Once all the features are working as expected, that will be
taken as baseline. New upgrades/updates/fixes will be treated as release. I'll tell
you when it should be considered update/new release."*

Recorded as locked invariant **I17**, because this is exactly the kind of decision a
cold session re-decides differently — and because across several turns of this
session I repeatedly suggested tagging a release so the auto-updater would have a
target. That suggestion is now answered and retired: **not before baseline, and never
on my initiative.**

### The policy

1. **Baseline is not yet declared.** The current state is pre-baseline, whatever the
   version field says.
2. **Baseline means every feature works as expected** — master's words. Section 28's
   ledger is the evidence base for that judgement, and the checklist below is what
   still stands between here and there.
3. **After baseline, a change is a release** — an upgrade, an update or a fix.
4. **Master classifies. Rāma does not.** Which of those three a given change is, and
   whether it warrants a release at all, is master's call. My job is to prepare the
   change and say what it would be; his is to label it.
5. **No tag, no publish, no version bump without master saying so.** `releaseChannel`
   stays dormant until then, and that is the correct state, not a defect.

### Pre-baseline behaviour that had to be right

If no release exists, the app must not pester master about updates or misreport their
absence as a fault. That was already handled for the automatic check (row 70). Two
things were not, and were found while verifying this:

**Two crash paths of my own making.** Row 70 moved the `electron-updater` require
*inside* `setupAutoUpdater()` so a broken dependency chain could not kill startup.
But two module-scope call sites still referenced the now function-local name:

- the tray's **Check for Updates** item
- the `updater:install-now` IPC handler

Both would throw `ReferenceError: autoUpdater is not defined`, and since `crashGuard`
treats `uncaughtException` as always fatal, **clicking a tray menu item would kill a
working app.** The install handler was not even `isDev`-guarded, so it crashed in
development too. Fixing a startup crash had created two click-to-crash paths — the
same lesson as row 70 itself, one layer along.

Fixed by keeping the lazily-required instance in a single module-scope `updater`
reference that `setupAutoUpdater()` populates, and guarding both call sites. The
manual check is now separate from the automatic one, because the right answers
differ: an automatic check that finds nothing should stay quiet, while master
clicking the item deserves a reply either way. Pre-baseline that reply is *"No
releases published yet — this build is the current one"*, delivered as information.

### What stands between here and baseline

Compiled from Section 28 rather than from memory. Two classes, and the second matters
more.

**A. Verified nowhere but this machine** — needs master to install a build:

- the installed app launching successfully at all (rows 66, 67, 70)
- `crashGuard` showing Rāma's dialog rather than Electron's raw stack (row 67)
- `selfRepair` fetching a missing module inside a real packaged install (row 71)
- the loyalty-core migration running against a pre-Section-56 install (row 75)
- the `ready` readiness path and the branded-installer skip (row 68)
- NanaZip detection and staging (row 69)
- agent assimilation and ledger restore inside the running app rather than a probe
  (rows 72, 76)

**B. Features that do not work, or report success while doing nothing.** These are
the real baseline blockers: a baseline that includes them enshrines a lie, and this
session has already had to correct three of exactly this shape (`statusFor()`'s false
green, `verify()` checking only file existence, `evolution:self-assess`).

- **`evolutionEngine` has no synthesis step.** `buildEvolutionProposal` always sets
  `changes: []`, so the applier always throws. Scouting works; absorption cannot
  complete. (row 65 area / Section 54)
- **`evolution:self-assess` is a hardcoded literal** — six fixed scores that read
  nothing, one of which reports "no feedback loop" as a finding.
- **`metaCognition.optimizationVectors()` is consumed by nothing.** Real conclusions,
  terminating at a display panel.
- **`agentOrchestrator.executeAction()` returns hardcoded strings and queues
  nothing** — "Web search queued via browserEngine" queues no web search. The agent
  action layer is a stub, so an agent is one model call, not a tool-using loop.
- **`agents:approval-needed` has no resume path.** An agent awaiting approval is a
  dead end.
- **`sandbox:approve` re-runs caller-supplied code without re-classifying it**, so
  what master approves is not proven to be what was classified.
- **`selfCare.checkSandbox()` is a stub that always reports healthy**, and
  `selfHeal()` implements three actions while its header claims more.
- **The `DEPENDENCY` proposal kind has no applier** — an approved one fails at apply.
- **`metaCognition` does not persist `byTool`**, so optimization vectors are lost on
  every restart and must be relearned.

That list is the honest answer to "are all the features working as expected". It is
not exhaustive of everything unfinished, but every entry is something I have read and
confirmed in this session.

### The release log

Empty by design. First entry is written when master declares baseline.

| Version | Date | Class | What changed | Declared by |
|---|---|---|---|---|
| — | — | — | *pre-baseline; no release cut* | — |

---

## SECTION 61 — "No handler registered for 'session:unlock'" — the diagnosis

Master reported this three times, and my first three explanations were all wrong. The
evidence that settled it was timestamps, not code.

### The measurement that should have come first

| Artefact | Modified |
|---|---|
| `build/` — the prebuilt renderer | **Aug 20, 23:37** |
| newest file in `src/` | Aug 21, 23:12 |
| packaged `app.asar` | **Aug 21, 11:14** |
| newest file in `electron/` | Aug 22, 00:50 |
| Vite dev server | not running |

**Master was running code that predated the entire session.** That explains both of
his observations at once, which no code-level theory did:

- *"the new login page itself is not showing errors"* — the renderer was 24 hours
  stale. And because Vite was not running, running from source **also** served that
  stale `build/`, so even the source tree showed yesterday's UI.
- *"the previous error still coming up"* — the main process was equally stale, so
  every fix from this session was absent from the running app.

Confirmation from the artefact itself: `electron/lib/` inside the asar contains 16
entries and **none of `loyaltyGuard.cjs`, `loyaltyCore.cjs` or `selfRepair.cjs`** —
the files this session created. The build could not possibly have contained the
behaviour being tested.

### What the artefact audit ruled out

`npm run audit:package` against that asar: 12,266 entries, 741 package directories,
every package on a real load path present, one macOS-only optional absent and
correctly degrading. A direct check of the boot path found **all of it present** —
`main.cjs`, `preload.cjs`, `sessionManager.cjs`, `cryptoCore.cjs`, `dataStore.cjs`,
`nucleusSealer.cjs`, `genome.cjs`, `authEngine.cjs`, `capabilities.json`,
`build/index.html`, 53 main-process files, 134 renderer entries.

So the failure was **not** missing files and not row 66 repeating. Packaging is sound.

### What the failure actually was, and why it was invisible

In that build, `app.whenReady().then(...)` had **no rejection handler**, and the 40
`register()` calls were bare sequential statements. A throw anywhere in that block
abandoned every later registration while the window still opened. `sessionMgr` is
third from last, so the passcode screen — the first thing master touches — is the
most likely victim of a fault anywhere upstream of it.

And it was silent by construction: the only symptom available was Electron's own
message, which names the channel that failed and never the cause. Rāma's own
diagnostics (`health:startup`, the load-failure record, the crash reports) all sit
**behind the gate that would not open**. That is the identical trap as Section 49's
`bootFailurePage`, whose four call sites were all downstream of the failure it
existed to report.

Three of the four `safeRequire` stub properties made it worse rather than better: a
module that fails to load is replaced by an inert stub whose `register()` is a
**no-op that does not throw**, so a per-call guard reports nothing and only that
subsystem's channels quietly vanish.

### Fixes, in the order they were made

1. **Per-registration guards.** Registration is a table walked in a loop, order
   preserved exactly, each entry independently guarded — one broken engine costs only
   its own channels and is named in the log.
2. **`whenReady` gained a `.catch()`.** It writes a crash report and shows a dialog
   naming what did not start. It deliberately does not kill the app: a partly-started
   Rāma that can say what went wrong beats one that exits.
3. **The boot path checks itself.** Every module now receives a thin recorder in
   place of `ipcMain` which forwards to the real one and records channel names —
   Electron offers no way to ask whether a channel is registered, so without this a
   missing handler can only be found by a renderer calling it and failing. After
   registration, the channels the passcode screen needs are verified present and the
   critical modules are checked with `isStub`. Anything missing produces a **native**
   dialog naming the load failures, the absent channels and the registration errors,
   plus a button to open the crash-report folder. Native, because at that point the
   renderer cannot be relied on.
4. **`crashGuard.record()`** added, for a fault caught elsewhere that deserves a
   durable report without termination.
5. **`build/` rebuilt**, so running from source without Vite no longer serves a
   day-old renderer.

### Two corrections to standing assumptions

- **`vite build` does work in this workspace.** The steering file says
  `node_modules` is not installed here and so the build cannot be verified. It is
  installed — `npm run build` completes in about 7 seconds, and `argon2` and the asar
  reader both load. The real limit is narrower: **the installer** cannot be produced
  here because the 7-Zip binary is blocked by policy (Section 51).
- **A stale artefact must be ruled out before a code-level theory.** Three
  explanations were proposed and tested against source that was never running. The
  cheap measurement — timestamps of `build/`, `app.asar` and the source tree — would
  have ended it immediately.

### For the record: what a wrong passcode does

Master asked, and it is worth stating because it rules the passcode out entirely.
`cryptoCore.unlock()` always succeeds (deriving keys from any string works), then
`verifyPasscode()` fails, and `masterUnlock` **returns** `{ ok: false, error:
'Incorrect passcode' }` — a value, never a throw. `Unlock.jsx` renders it under the
input. A wrong passcode therefore shows **"Incorrect passcode"**, and can never
produce "No handler registered", which means the channel does not exist and the
passcode was never examined.

### Still unresolved

Which subsystem threw in that build is unknown and now unknowable — it was never
logged, and the build is superseded. The next run reports it by name. If the rebuilt
app starts cleanly, the fault was in code this session has already replaced; if it
does not, the dialog names it.

---

## SECTION 62 — `Module._initPaths()` cost the packaged app every one of its engines

The root cause of "No handler registered for 'session:unlock'". It was mine,
introduced by Section 53's self-repair work, and it was invisible in development by
construction.

### The mechanism

`selfRepair.registerRepairPath()` made the writable repair directory resolvable by
setting `NODE_PATH` and calling `Module._initPaths()`. Its own comment described
`_initPaths` as re-reading `NODE_PATH` into `Module.globalPaths` — the mistake is in
the word *re-reading*. **`_initPaths()` does not extend the search paths, it
recomputes them from scratch.** Electron patches Node's module system so that paths
inside `app.asar` resolve; recomputing discards those patched entries.

`safeRequire` then called it at the worst possible moment — `ensureRepairPath()` ran
before the **first** guarded require, i.e. in the middle of `main.cjs`'s module-scope
require chain. So:

1. first `safeRequire(...)` → `_initPaths()` → asar resolution destroyed
2. every subsequent `require()` fails with `MODULE_NOT_FOUND`
3. `safeRequire` returns an inert stub for each, whose `register()` is a **silent
   no-op**
4. `sessionManager` and `dataStore` are the **last two** loaded, so their channels
   were the visible casualties

**Development has no asar**, so `_initPaths()` recomputed ordinary paths that still
worked and nothing looked wrong. Every test in this workspace passed. The failure
existed only in a packaged build.

### Why it took so long, and what would have shortened it

Six explanations were offered before this one. What made it hard was that every
signal pointed away from the truth:

- `audit:package` reported **"every package on a real load path is present"** — and
  it was right. The packages were there; they had become *unresolvable*.
- The build log was clean: 30 pinned packages, both native binaries built, installer
  and portable produced.
- Reinstalling `node_modules` changed nothing, correctly, because nothing was missing.
- `sessionManager` and `dataStore` load cleanly in isolation, and all 36
  registrations succeed against a stub `ipcMain`.

What finally identified it was the crash report shipped over git: **all four**
boot-critical channels absent, including `store:get`. Two independent subsystems
producing zero channels while throwing nothing meant stubs, and stubs meant load
failure — with the packages provably present. That combination has exactly one
explanation.

The lesson worth keeping: **"the packages are present" and "the packages are
resolvable" are different claims, and only the second one matters.** The package
audit proves the first and reads like it proves the second.

### The fix

Two halves, because the mistake had two halves.

**Mechanism.** `Module._initPaths()` is gone. Resolution is extended by wrapping
`Module._resolveFilename` so the repair directory is consulted **only after normal
resolution has already thrown**, using the documented `options.paths` form —
the same mechanism `require.resolve(x, { paths })` uses. Two consequences, both
wanted: repair can never shadow a working module, not by convention but because the
code does not execute unless the normal walk already failed; and nothing existing is
removed, recomputed or reordered.

An earlier attempt appended to `Module.globalPaths`, which does nothing — Node
resolves bare specifiers through an internal `modulePaths`, and `globalPaths` is only
the copy `_initPaths()` publishes. The behavioural test caught that before it shipped.

**Timing.** `safeRequire` no longer touches module paths at all. `ensureRepairPath()`
is exported and called once from `whenReady`, after every engine has loaded, where a
previously-repaired module is picked up by `retryFailures()` anyway. Even with a safe
implementation, path surgery inside the require chain is not being reinstated.

### Verification

15 assertions, and the important ones assert the *invariant* rather than the symptom,
since the symptom is invisible without an asar:

`Module.globalPaths` is not recomputed; `express`, `crypto` and `path` all **still
resolve** after `registerRepairPath()` — the exact failure that stubbed every engine;
the require cache is not cleared; a module planted in the repair directory becomes
require-able (proving the mechanism actually works, which the first attempt did not);
relative requires are unaffected; a genuinely absent package still fails cleanly with
its original error; repeated registration stays safe. Three assertions guard against
the mistake returning: neither `selfRepair.cjs` nor `safeRequire.cjs` may call
`Module._initPaths` in live code, and `safeRequire()` may not call
`ensureRepairPath()`.

### What this says about the session

Sections 49, 52, 53 and 61 all added resilience machinery, and three of them
introduced a fault of their own: the crash guard killed a working app (52), the
updater guard turned a tray click into a fatal error (row 78), and self-repair cost a
packaged build every engine it had (this). Each was written to prevent a failure and
became one.

The common shape is not carelessness, it is **testing the mechanism in the
environment where it cannot fail**. `crashGuard` was tested with `electron` stubbed;
`selfRepair` was tested in a checkout with no asar. Both passed. The honest conclusion
is that resilience code needs to be exercised in the environment it defends, and this
workspace cannot produce an installer (Section 51) — so for anything touching module
loading, packaging or startup, **master's build is the only real test**, and that must
be stated as a limit rather than papered over with local passes.

---

## SECTION 63 — `safeRequire` resolved every path one directory too deep

The actual root cause. Eight explanations were offered before this one; the boot
report identified it in a single read.

### The evidence

```
MODULE LOAD FAILURES (39)
  System sensing      reason: missing module "./ipc/system.cjs"
  Filesystem          reason: missing module "./ipc/filesystem.cjs"
  … 39 of 39 …
  Session manager     reason: missing module "./sessionManager.cjs"
  Encrypted store     reason: missing module "./dataStore.cjs"

BOOT PATH RESOLUTION CHECK
  ../sessionManager.cjs   resolves
  ../dataStore.cjs        resolves

registered total: 13      session:* present: NONE
```

**Every guarded require failed, while the same files resolved fine from the report
writer.** That contradiction is the whole diagnosis.

### The mechanism

`main.cjs` calls `safeRequire('./ipc/system.cjs')`. That path is relative to
`electron/`, because that is where the caller lives. But `safeRequire.cjs` is in
`electron/lib/`, and a bare `require(id)` inside it resolves relative to **its own**
file — so it looked for `electron/lib/ipc/system.cjs`, which does not exist.

Consequences, in order:

1. all 39 guarded requires fail with `MODULE_NOT_FOUND`
2. each returns an inert stub whose `register()` is a **silent no-op**
3. the app registers **13** IPC channels instead of ~257, and **no `session:*` at
   all** — the 13 are the handlers defined inside `main.cjs` itself, which never go
   through `safeRequire`
4. the first thing master touches is the passcode screen, so the symptom is
   "No handler registered for 'session:unlock'"

It has been broken since the refactor that introduced `safeRequire` (Section 49) and
was never noticed, because nothing verified that the app launched afterwards — every
ledger row since carries the note *"not verified: that the installed app launches"*.
That note was doing real work and was never acted on.

### Why the stub design turned a total failure into a puzzle

`safeRequire` returns a stub rather than throwing, so that one broken engine cannot
kill the app. Applied to *its own misuse*, that reasoning inverts: a mistake in the
loader itself is indistinguishable from 39 unrelated missing packages. A guard that
silently swallows evidence of its own failure is worse than no guard — it made a
total failure look like a partial one, which is why every explanation that followed
was about *packaging* rather than *resolution*.

Two claims that were both true and both misleading:
- `audit:package` — "every package on a real load path is present". Correct. The
  packages were never the problem.
- reinstalling `node_modules` changed nothing. Correct, and for the same reason.

### The fix

Resolution is anchored to `electron/` by default via
`createRequire(path.join(__dirname, '..', 'main.cjs'))`, so the correct behaviour
does not depend on anyone remembering to configure it. `main.cjs` additionally calls
`useRequire(require)`, making the anchor the caller's own rather than an assumption
this file makes about who calls it.

`retryFailures()` uses the same requirer, or it would have re-tried against the wrong
root and reported permanent failure.

### Verification

23 assertions, and they test the property that was actually violated rather than that
the function returns something:

Every id **exactly as `main.cjs` passes it** loads without configuration — `./ipc/*`,
`./sessionManager.cjs`, `./dataStore.cjs`, `./lib/*` — with zero load failures. The
results are checked to be the real modules and not stubs wearing their names
(`sessionManager.register` is a function, `dataStore.DOMAINS` contains `proposals`).
A genuinely absent module still stubs cleanly, refuses politely, and is recorded.
`useRequire` demonstrably changes resolution, so the mechanism is proven to be live
rather than incidentally correct.

### The lesson, stated plainly

Three separate faults in this session came from the same habit: **verifying a
mechanism in the environment where it cannot fail.** `crashGuard` was tested with
`electron` stubbed (Section 52). `selfRepair` was tested in a checkout with no asar
(Section 62). `safeRequire` was tested by calling it from a probe that sat in a
directory where its paths happened to work — never from `main.cjs`, which is its only
real caller.

The correct discipline for a loader is to assert the *identity of what came back*,
not merely that something did. Section 49's 27 assertions checked that a stub refuses
politely and that guidance avoids impossible npm advice. Not one checked that a
non-stub was returned for a module that exists.

---

## SECTION 64 — StockMind: fixing the defects that made its output meaningless

Master's intent, stated directly: **StockMind exists to generate wealth for a real
trader**, and Rāma must be able to upgrade the capability itself. This section fixes
the correctness defects first, because until they are fixed no improvement can be
measured — a stronger model behind an inverted calibration still reports weaker
numbers.

### The decisions, before the code

**1. Calibration — the highest-impact defect.**
`platt_scale(p, A=1.0, B=0.0)` returned `1/(1+exp(A*p + B))`, documented as
"identity". It is monotonically *decreasing*: p=0.95→0.279, p=0.05→0.488. So reported
confidence was **anti-correlated with the ensemble's own signal**, and after the
regime multiplier the range collapsed to ≈0.29–0.51, making `A+`/`A` grades
arithmetically unreachable.

Two errors compounded: Platt scaling applies to a **decision-function score**, not to
a probability, and the sign was flipped. Fixed by converting the probability to
log-odds first and applying `sigmoid(A*z + B)`, which **is** genuine identity at
A=1, B=0. Rejected simply flipping the sign, because that would still be scaling the
wrong quantity and would silently break the moment real `A`/`B` are fitted.

**2. Health must not claim readiness it cannot have.**
`get_health()` read `ensemble_size`, which is `len(self._base_models)` — a constant 7
regardless of what loaded — against a hardcoded `total = 4`, and reported *"7/4 models
loaded with real artifacts"* with `ece` and `brierScore` hardcoded to `0`, which reads
as perfect calibration. Now it counts models that genuinely report `is_available()`,
totals the real ensemble, and reports `ece`/`brierScore` as **`null` with an explicit
`calibrationMeasured: false`** rather than 0. A metric nobody has computed must not be
reported as a perfect score.

**3. Feature names derived, never hand-maintained.**
`get_feature_names()` returned 37 hand-written names for a 59-value vector and
diverged after index 30, so `dict(zip(names, features))` in `_generate_reasons`
attributed the wrong number to every reason above that index, and `hurst_exp` was
absent entirely so its branch could never fire. The fix removes the class of bug
rather than the instance: `compute_features_dict()` becomes the single builder, the
vector is `np.array(list(d.values()))`, and the names are `list(d.keys())`. They
cannot drift apart because they come from the same dict.

**4. Regime detection by name, not by guessed index.**
`detect_regime` read indices 8/15/10/12 believing them to be ATR/ADX/BB-width/RSI.
Only index 8 was correct — 15 is `ema10_slope`, 10 is `parkinson_vol`, 12 is
`bb_position`. It now takes the named feature mapping.

**5. Stop discarding what the ensemble computed.**
The registry computes `p_t1/p_t2/p_t3`, `suppressed`, `suppress_reason` and
`regime_detected`, and `_build_signal` threw all of it away — hardcoding
`suppressed: False` (so `suppressedCount` was structurally always 0), `regime:
"trending"`, and recomputing T2/T3 probabilities with fixed −0.18/−0.38 decrements.
The signal now carries the values the ensemble actually produced.

**6. Signal multiplicity was fabricated — replaced with honest variants.**
`_spot_signals` computed one feature vector and called
`ensemble_predict(features + np.random.normal(0, 0.01, ...))` N times, then sorted by
the resulting noise. Sixteen "signals" were one bar of information plus jitter, and
the ranking was ranking noise.

One bar yields **one directional view**. So the engine now makes a single prediction
and derives N **risk variants** from it — different stop/target geometry over the same
view — each with a barrier-probability derived from that geometry rather than from
noise. For a driftless walk, P(hit +a before −b) = b/(a+b); the directional edge is
blended in and the result stated as an approximation. Fewer, honest, genuinely
different setups beat sixteen copies of one guess. Reasons now say so explicitly.

**7. Real ATR, not a 0.9% guess.**
Levels were built from `atr = base * 0.009` while `features.py` computed a real
`atr14_pct` that was never used. Now the measured value drives the geometry, with the
hardcoded proxy kept only as a fallback when the feature is unavailable.

**8. `minGrade` was accepted, validated, and ignored.** It now filters.

**9. Validity windows were non-monotonic.** `_validity_ts` used `(16 - rank) * 15`
minutes, so with `signalCount > 16` validity ran *backwards into the past*. Now
derived from the requested count.

**10. Backtest — five defects, one of them lookahead.**
`grade` was computed as `0.5 + rr*0.1 + (0.05 if outcome != "SL_HIT" else -0.1)` —
**derived from the realized outcome**, so the reported grade distribution was read off
the answer key. `TIMEOUT` was booked as a **full stop-loss** rather than marked to
market, and T2/T3 wins were credited at T1 size, biasing P&L, Sharpe and Calmar in
opposite directions. Windows advanced by `test_size // 10`, re-testing each bar ~10×
and inflating `signalsTested`. Sharpe was `mean/std` with no annualisation. And four
functions were **defined twice**, the second silently winning, leaving ~200 lines of
dead code that did not match the live signature.

All five fixed; the dead copies deleted; Sharpe annualised from the interval's
bars-per-year. The `stable` verdict now reports measured accuracy without asserting a
75% floor a naive ATR bracket cannot reach.

**11. The live data path was unreachable.** `fetch_ohlcv_yahoo` is `async` and
`get_ohlcv` is synchronous, so nothing ever awaited it — every prediction ran on
`mock_ohlcv`, a random walk seeded by the typed base price. A synchronous fetch path
is added and actually called, with mock as the last resort. `mock_ohlcv` also
**reseeded the global numpy RNG**, silently making unrelated downstream randomness
deterministic; it now uses a local `Generator`.

**12. Wall-clock leaked into the features.** The six cyclical time features used
`datetime.now()` rather than the bar's timestamp. Harmless while nothing is trained,
**fatal the moment anyone fits on history** — the model would learn "what time is it
now" instead of "what time was that bar". Now taken from the bar when a `date` column
exists.

**13. Missing Python was an uncaught exception.** `aiProcess.cjs` spawns without a
`child.on('error')` handler, so an absent interpreter emits an unhandled `error`
event rather than a reported failure — and `spawn` does not throw synchronously, so
the surrounding `try/catch` never covered it.

### What this section deliberately does not do

- **No trained models.** Fixing arithmetic is not training. All 8 models still fall
  back to heuristics; `/health` now says so honestly instead of claiming 7 loaded.
  Training needs a defined label and horizon — master's answer on trading horizon is
  still outstanding, and the label follows from it.
- **No chart yet.** The renderer work waits on a real OHLCV series crossing IPC.
- **No live-money automation.** The disclaimer stays and strengthens as capability
  grows.

### Verification limit, stated plainly

This workspace has Python 3.14 with none of the pinned packages, and
`numpy==1.26.4` cannot build there. Tests ran in a throwaway venv on **numpy 2.5.2 /
pandas 3.0.5 / scikit-learn 1.9.0** — newer than `requirements.txt` pins. The defects
fixed here are logic defects rather than version-sensitive behaviour, so that gap is
acceptable for verifying them, but it is a gap: **the pinned combination is not
exercised here.** Given that three faults this session came from testing in an
environment where the fault could not appear (Sections 52, 62, 63), that limit is
recorded rather than glossed.

---

## SECTION 65 — StockMind: real market data, decades deep, free first

*Recorded retroactively. The code shipped in `637ba2c`; the decisions were not written
down, which is the gap this section closes. A cold session reading only the ledger would
have re-decided all of them.*

### The requirement

Master's words: read data "since the introduction of online market data or next best
immediate thing", "utilise free resources but can accommodate/integrate premium
resources and enable/disable them according to our needs."

Two things follow that are easy to miss. **Free-first is not free-only** — the premium
slots have to exist and be dormant, not be added later. And **enable/disable has to be
per-provider**, because the reason to disable one is usually that it started charging or
started lying, not that the whole chain is unwanted.

### The chain

`ai_backend/engine/providers.py` holds an ordered list. Each entry declares its tier
(`free` / `premium`), the env var that enables it, and the env var carrying its key.
`get_ohlcv` walks the chain until one answers with a usable frame.

**Alpha Vantage is registered `premium` even though a free key exists.** 25 calls a day
at 100 points a call means a decade of daily history costs roughly a month of quota. A
provider that cannot deliver the depth being asked for is not a free provider for this
purpose, and classifying it free would strand the chain on it.

### The store is primary, providers only fill it

`ai_backend/engine/store.py` keeps an append-only local series per
`(exchange, symbol, interval)`.

This is the decision most likely to be undone by someone optimising for simplicity, so
the reasoning is worth stating plainly: **a backtest whose data depends on whoever
answered an HTTP call is not reproducible.** Every free provider rate-limits, several
silently change what they return, and none guarantee the same history twice. Fetching at
request time makes the *measurement* a function of the network. So bars are fetched once,
merged, and read locally thereafter.

Consequences, all deliberate:

- The store **refuses to shrink.** A merge that would reduce the bar count is rejected.
  A provider having a bad day must not be able to delete history.
- Writes go through a temp file and `os.replace`, so an interrupted write cannot leave a
  truncated series.
- Staleness is **business-day aware.** "Last bar is 2 days old" on a Monday morning is
  current, not stale.

### CSV, not parquet

`pyarrow` is large, the dependency pins are deliberate (I12), and thirty years of daily
bars is about 7,500 rows. Parquet would buy nothing measurable and cost a heavy pinned
dependency on every platform the installer has to work on.

### The Yahoo defect worth remembering

`range=max&interval=1d` **silently downsamples to monthly.** It returned 228 bars for
18.9 years and no error, no warning, and a perfectly well-formed response.

Explicit `period1`/`period2` epochs return 4,649.

This is the failure mode that passes every check anyone writes by reflex — the request
succeeded, the frame parsed, the columns were right, the dates were real. So the test
does not assert a bar count. It asserts **bars-per-year ≥ 150 and median gap between
bars ≤ 5 days**, which is a claim about the *shape* of the series and cannot be satisfied
by monthly data pretending to be daily.

### Verified

57 assertions in `ai_backend/tests/test_store.py`, including a live fetch. Live result:
**4,649 daily NIFTY50 bars, 2007-09-17 → 2026-08-28, 18.95 years, no duplicate dates.**
`ai_backend/data/` is gitignored, so a fresh clone syncs on first use.

Known data quality note carried forward: **1,334 of those bars have zero volume** —
Yahoo does not report index volume for the early years. That is not a bug to fix, it is a
property to handle, and Section 66 records what it broke.

---

## SECTION 66 — StockMind: a backtest that measures the predictor, and the infinite loop it uncovered

Task 1 of the six-part StockMind build. `ai_backend/engine/backtest.py`, rewritten.

### What was there

The old file did not test the predictor. Not badly — **not at all.**

`MODEL_REGISTRY` was never referenced. `train_size` was computed and never used to fit
anything. What it measured was a fixed ATR bracket walked over price, which means it
could never answer the only question that matters: *does the prediction work?*

Four functions were also defined twice. Python keeps the second, so the first ~210 lines
were unreachable — including a `run_backtest` whose signature did not match the call in
`main.py`. Nobody could have noticed, because the dead one was the one that looked right.

### The six defects, each of which moved a reported number

1. **Grade was read off the answer key.**
   `grade = 0.5 + rr*0.1 + (0.05 if outcome != "SL_HIT" else -0.1)`.
   The grade was **derived from the realized outcome**. The reported grade distribution
   was therefore a restatement of the results, and "A+ signals win more often" was true
   by construction. Straight lookahead.

2. **`TIMEOUT` was booked as a full stop-loss.** A signal that expired flat was recorded
   as a maximum loss, so every loss statistic was overstated.

3. **T2 and T3 wins were credited at T1 size.** Wins understated, losses overstated —
   which biases P&L, Sharpe and Calmar in *opposite directions at once*, so no single
   sanity check on the summary would catch it.

4. **Windows overlapped ~10×.** `step = test_size // 10`, so with a 60-bar window a new
   one began every 6 bars and each bar was re-tested about ten times. `signalsTested` was
   inflated an order of magnitude and the "independent" windows were near-duplicates.

5. **`mean/std` was reported as a Sharpe ratio** with no annualisation. That is not a
   Sharpe ratio, and labelling it one invites a comparison that cannot be made.

6. **A 75% accuracy floor produced a permanent `retrain_required`.** A mechanical ATR
   bracket does not win 75% of the time and never will. The verdict was always the same,
   so it carried no information, and a verdict nobody can act on is worse than none.

### Decisions

- **Non-overlapping windows.** A trade opens at a bar, resolves against the next
  `horizon_bars`, and the next candidate starts *after* the resolution
  (`idx += bars_held + 1`). No bar is evaluated twice, so `signalsTested` means what it
  says.
- **The stop is assumed hit first** when a bar's range spans both stop and target. OHLC
  cannot resolve the order. Assuming the target came first manufactures profit that may
  not exist, and a backtest that flatters is worse than no backtest.
- **TIMEOUT is marked to market** at the final close.
- **T1/T2/T3 are credited at their own level.**
- **Sharpe and Sortino are annualised** via `INTERVAL_PERIODS_PER_YEAR`, scaled by
  *realised* trade frequency rather than bar count, because trades are not one per bar.
- **Grade comes from pre-trade edge and geometry only**, through the same
  `barrier_probability` the live engine uses, so backtest grades and live grades are
  comparable quantities.
- **`stable = None`, `action = "measured"`.** The backtest reports; it does not issue a
  pass/fail it has no basis for.
- **ECE and Brier are measured against realised outcomes** of these trades. These are the
  first honestly-measured calibration numbers in the system — Section 64 made `/health`
  report `null` rather than a fake `0`, and this is what will eventually fill it in.
- **`FEATURE_WINDOW = 400`.** The deepest feature lookback is 252 bars (52-week
  high/low, EMA(200)), so a 400-bar trailing slice gives values *identical* to passing
  the whole history, at O(400) per call instead of O(idx). Passing `df.iloc[:idx+1]`
  would be quadratic overall, since several feature routines walk their input in a Python
  loop.

### The actual find: an infinite loop in the live feature path

`run_backtest` finished 100 trades in 0.7s and **did not finish 400** — not slowly,
never. Linear up to a point and then unbounded is not a performance profile, so the cause
was not the thing being tuned.

`faulthandler.dump_traceback_later(15, repeat=True)` settled it in one run. Three
consecutive dumps all landed inside a four-line span of
`advanced_features.market_profile_features`.

The value area expands outward from the Point of Control, taking the heavier neighbour
each step, until 70% of volume is enclosed. The loop read an **exhausted** side's
contribution as `0`:

```python
add_low  = vol_profile[va_low_b - 1]  if va_low_b > 0              else 0
add_high = vol_profile[va_high_b + 1] if va_high_b < n_buckets - 1 else 0
if add_high >= add_low:
    va_high_b = min(va_high_b + 1, n_buckets - 1)   # clamps to the SAME index
    va_vol += add_high                              # adds 0
```

When the POC sits in the top bucket and the bucket below it is empty, `add_high` is 0
because the high side is exhausted and `add_low` is 0 because that bucket holds no
volume. `0 >= 0` chooses the high side. `min` clamps to the index it is already at.
`va_vol` gains nothing. And the loop condition stays true, because the `or` sees that the
*low* side still has room.

**Nothing changes, forever.**

Three things make this worse than a corner case:

- It is reachable **on data alone**, with no unusual input. Twenty bars binned into
  twenty buckets leaves empty buckets routinely, and a POC in the top bucket is just a
  breakout.
- Section 65 recorded that **1,334 early NIFTY bars have zero volume.** Empty buckets are
  not rare in this data, they are guaranteed.
- **It hung live `/predict` calls too**, not only backtests. The backtest found it
  because the backtest is the first thing that calls the feature stack thousands of
  times. A user would have experienced it as a request that never returned.

### The fix is structural, not a counter

```python
can_low  = va_low_b > 0
can_high = va_high_b < n_buckets - 1
add_low  = vol_profile[va_low_b - 1]  if can_low  else -1.0
add_high = vol_profile[va_high_b + 1] if can_high else -1.0
if can_high and (not can_low or add_high >= add_low):
    va_high_b += 1
    va_vol += vol_profile[va_high_b]
else:
    va_low_b -= 1
    va_vol += vol_profile[va_low_b]
```

A `-1` sentinel keeps an exhausted side out of the comparison (volumes are ≥ 0), and
**exactly one index moves per iteration**, so the loop is bounded by `n_buckets - 1` *by
construction*.

An iteration counter was the obvious alternative and is the wrong answer: it would leave
the no-progress branch in place, silently truncate the value area, and turn a logic error
into a quietly wrong feature value. Termination should be a property of the loop, not
something bolted to the outside of it.

### Proven in both directions before shipping

A regression test that passes on the broken code is worthless, so the reproduction was
verified against the original loop, run verbatim in a throwaway script:

```
poc_bucket=19 total=390.0 va=200.0 need=273.0 below_poc=0.0
OLD LOOP: 50,000 iterations with NO state change -> infinite
fixed loop: in_value_area=1.0
```

The frame is 19 bars parked in the bottom bucket and one heavy bar alone in the top:
POC at bucket 19 holding 200 of 390 total — under the 70% threshold, so the area *must*
expand — with bucket 18 holding exactly 0.0.

Because the failure mode is a **hang**, the nine new assertions in `test_defects.py` run
the function on a daemon thread with a join timeout. An assertion cannot catch a loop
that never returns. They cover the crafted frame, its mirror (POC in the bottom bucket —
not reachable in the original code, but the fix must not introduce it), an all-zero-volume
window, the full `compute_advanced_features` bucket, and a sweep of **180 consecutive
windows with scattered zero volume**.

### Removed: a guard added while chasing the wrong cause

While the hang was still unexplained I added an `iterations > len(df) * 3` guard to
`run_backtest`'s walk-forward loop. It is **unreachable** — every path through that body
advances `idx` by at least one, so the walk is bounded by `len(df)` already — and its
comment blamed the wrong subsystem.

It is gone. A guard that cannot fire does nothing but misdirect whoever reads it next,
and a comment asserting a false root cause is worse than no comment. The numpy hoisting
added in the same pass is kept, because it is a real constant-factor saving, but its
comment now says so instead of claiming to fix something.

### Verified

**202 assertions green** in the throwaway venv:

| Suite | Assertions |
|---|---|
| `ai_backend/tests/test_defects.py` | 83 (74 existing + 9 new) |
| `ai_backend/tests/test_store.py` | 57 |
| `ai_backend/tests/test_backtest.py` | 62 (new) |

Full 18.9-year NIFTY50 run, all caps completing:

| Cap | Time | Trades | Won | Sharpe | Max DD |
|---|---|---|---|---|---|
| 100 | 0.6s | 100 | 58.0% | 2.12 | 15.0% |
| 400 | 2.4s | 400 | 49.0% | 0.87 | 30.5% |
| 2000 | 4.3s | 715 | 48.8% | 0.78 | 31.8% |

**Read that table before trusting a short backtest.** The first 100 trades show 58% and
a Sharpe of 2.12; the full sample shows 48.8% and 0.78. The difference is that the first
100 trades land in the 2009-11 recovery. Same code, same geometry, same data source — the
only variable is how much history was allowed in. ECE over the full run is 0.017, which
is well calibrated, and the win rate near 50% is the honest reading of a heuristic
ensemble with **no trained model in the loop**. That is the point of task 4.

### Verification limits, stated

- Tests ran on **numpy 2.5.2 / pandas 3.0.5 / scikit-learn 1.9.0**, newer than
  `requirements.txt`'s pins, because this workspace has Python 3.14 and `numpy==1.26.4`
  cannot build there. **The pinned combination is not exercised here.** Carried forward
  from Section 64.
- `lightgbm` and `xgboost` are absent, so those ensemble members were not in the loop.
  The measured numbers are for the members that were.
- Nothing here is a claim about future returns, and the disclaimer stays.

### Next

Task 2 of 6 — free NSE derivatives and flows (Bhavcopy archives, option chain with OI /
PCR / max pain, FII-DII flows, delivery percentage) into `providers.py` and `store.py`.

Still blocked and asked three times: **the trading horizon** — intraday, swing-days, or
positional-weeks. Task 4 cannot define a training label without it, and the current
default of 5 bars is a placeholder for a decision only master can make.

---

## SECTION 67 — StockMind: NSE derivatives and institutional flows, free and backtestable

Task 2 of the six-part StockMind build. Master's requirement covers "derivatives" and
"impact on index, stocks and derivatives" explicitly, on free resources.

*Written before implementing, per Section 28's working agreement.*

### What was probed, and what is actually true today

Nothing here is assumed. Every endpoint below was called from this machine before the
design was fixed, because NSE moved its archive host in 2024 and changed the bhavcopy
format, and most published guidance is stale.

**Works — archives (`nsearchives.nseindia.com`), and therefore backtestable:**

| What | Path | Verified |
|---|---|---|
| F&O bhavcopy, UDiFF | `/content/fo/BhavCopy_NSE_FO_0_0_0_{YYYYMMDD}_F_0000.csv.zip` | 29,852 rows for 2026-08-28 |
| F&O bhavcopy, legacy | `/content/historical/DERIVATIVES/{YYYY}/{MON}/fo{DDMONYYYY}bhav.csv.zip` | 38,267 rows for 2020-06-10 |
| Cash bhavcopy, UDiFF | `/content/cm/BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip` | 3,613 rows |
| Delivery percentage | `/products/content/sec_bhavdata_full_{DDMMYYYY}.csv` | 3,461 rows, `DELIV_QTY` + `DELIV_PER` |
| Participant-wise OI | `/content/nsccl/fao_participant_oi_{DDMMYYYY}.csv` | Client / DII / FII / Pro / TOTAL |
| Participant-wise volume | `/content/nsccl/fao_participant_vol_{DDMMYYYY}.csv` | same shape |

**Works — live JSON (`www.nseindia.com/api`), snapshot only:**
`marketStatus`; `fiidiiTradeReact` (FII/FPI and DII buy/sell/net, latest day);
`option-chain-contract-info?symbol=X` (expiry and strike lists);
`option-chain-v3?type=Indices&symbol=X&expiry=DD-MMM-YYYY` (full chain, plus
`filtered.CE.totOI` / `filtered.PE.totOI`).

**Dead:** `api/option-chain-indices?symbol=NIFTY` returns **404**. This is the endpoint
almost every tutorial and most wrapper libraries still use. `option-chain-v3` **without**
an `expiry` returns `{}` with status 200 — a silent empty, not an error, which is the
failure mode most likely to be mistaken for "no options today".

### Depth: derivatives history goes back to 2001

| Date | UDiFF | Legacy |
|---|---|---|
| 2026-08-28 | 29,852 | 404 |
| 2025-06-10 | 33,933 | 404 |
| 2024-06-10 | 46,303 | 46,303 |
| 2022-06-10 | 404 | 63,559 |
| 2010-06-10 | 404 | 26,637 |
| 2004-06-10 | 404 | 6,044 |
| 2002-06-10 | 404 | 1,667 |
| 2001-06-11 | 404 | **39** |

UDiFF covers roughly 2024 onward; legacy covers 2001 to 2024, with an overlap where both
answer identically. 2001 is not a limit of the archive — it is when index options started
trading in India. **So the two formats together are the entire history of the instrument
class**, which is the honest answer to master's "since the introduction of online market
data".

### Decision 1 — derivatives history comes from the archives, not the live option chain

The live chain describes today. The archive describes every day since 2001. Only the
archive can feed a backtest or train a model, so **the archive is the primary source and
the live chain is an intraday top-up**, labelled as not backtestable wherever it appears.

This is the same reasoning as Section 65's "the store is primary, providers fill it", and
it is worth restating because the live chain is the more tempting thing to build: it is
one HTTP call, it looks impressive, and it can only ever support a dashboard.

### Decision 2 — persist derived daily metrics, not raw contract rows

Twenty-one years at ~30,000 contract rows a day is on the order of 150 million rows. That
would break the CSV choice made in Section 65 and force parquet or a database.

The model consumes **features**, not contracts. So for each `(symbol, date)` one row is
computed and stored — about 5,000 rows for the full history, which is the same order as
an OHLCV series and fits the existing store exactly. Raw contract frames are parsed,
used, and dropped.

Stored per symbol per day:

- **Options:** `pcr_oi`, `pcr_volume`, `ce_oi`, `pe_oi`, `ce_oi_chg`, `pe_oi_chg`,
  `max_pain`, `max_pain_dist`, `max_ce_oi_strike`, `max_pe_oi_strike`,
  `resistance_dist`, `support_dist`, `oi_concentration` (Herfindahl across strikes —
  measures pinning), `straddle_pct`, `strikes_count`, `days_to_expiry`
- **Futures:** `fut_close`, `fut_basis_pct`, `fut_oi`, `fut_oi_chg`, `rollover_pct`
- **Provenance:** `spot`, `expiry`, `source` (`udiff` / `legacy`)

**`straddle_pct` is used instead of implied volatility.** Neither bhavcopy format carries
an IV column, and back-solving Black-Scholes per contract across 21 years is a large
amount of machinery resting on assumed rates and dividends. The ATM straddle as a
fraction of spot *is* the market's priced expected move to expiry, it is one subtraction
away from the raw data, and it needs no assumptions. Reporting a computed IV would be
more impressive and less honest.

### Decision 3 — spot comes from the OHLCV store, not from the file

UDiFF carries `UndrlygPric`. **Legacy does not.** Rather than have two different notions
of spot depending on which archive a date came from, spot is read from the existing
OHLCV store for that date, for both formats.

That also removes a class of silent inconsistency: `max_pain_dist` and `fut_basis_pct`
are ratios against spot, and a metric whose denominator changes source mid-history is a
feature that encodes *which file it came from*. The model would learn the archive
boundary. This is the same failure the Section 64 time-features bug had — a feature
carrying provenance rather than market state.

### Decision 4 — a 404 means "not published", not "failed"

Holidays and weekends both return **404 with an HTML body** (verified: 2026-01-15, a
trading holiday, and Sunday 2026-08-30). A 404 is therefore normal and expected for a
large fraction of calendar dates.

It is recorded as a known non-publication so a historical backfill does not re-request it
on every run, and it is reported separately from a genuine fetch failure. Conflating the
two would either spam the exchange or make a backfill look broken.

### Decision 5 — never advertise brotli

The first probe sent `Accept-Encoding: gzip, deflate, br`. NSE honoured `br`, and the
bundled `httpx` has no brotli decoder, so `fiidiiTradeReact` and `marketStatus` returned
**status 200 with 115 bytes of undecodable binary that parsed as neither JSON nor an
error**. It read exactly like a working endpoint returning junk.

Advertising an encoding we cannot decode is the bug. Adding a brotli dependency would fix
the symptom at the cost of a new pinned package (I12) for no benefit — the payloads are
kilobytes. `Accept-Encoding: gzip, deflate` only.

Also: `https://www.nseindia.com/` returns **403**, while `/option-chain` and
`/all-reports` return 200 and set the cookies the API requires. Warming on the root — the
obvious choice — yields one cookie and a subsequent 401.

### Decision 6 — generalise the existing store rather than write a second one

`store.py` had `COLUMNS` fixed to OHLCV. It also has the properties this data needs and
that are easy to get wrong: append-only with de-duplication on the date key, **refuses to
shrink**, atomic `os.replace`, per-symbol provenance, business-day-aware staleness.

So `load` / `merge` / `sync` take an optional column set, defaulting to OHLCV so every
existing caller is untouched (I11, additive). A parallel derivatives store would have
duplicated all six properties and drifted from them — and ledger row 19 exists precisely
because nineteen subsystems were once duplicated this way.

### Decision 7 — max pain is vectorised

Max pain is the strike at which option writers pay out least, evaluated across every
strike: an O(strikes²) computation, ~11,000 terms for a NIFTY expiry. Computed as a
broadcast payout matrix (`clip(S[:,None] - S[None,:], 0, None) @ ce_oi` plus the mirror
for puts) rather than a nested Python loop.

Section 66 was lost to a Python loop over market data. Doing this one per-day across 21
years in nested Python would be ~55 million interpreted iterations for a number that
numpy produces in milliseconds.

### Verified derivations, before any of it was wired in

Against 2026-08-28 NIFTY, nearest expiry 2026-09-01, spot 24,175.65:

- CE OI 181,520,495 / PE OI 140,861,175 → **PCR(OI) 0.776**
- Max CE OI strike **24,300** (resistance), max PE OI strike **24,000** (support)
- **Max pain 24,200** — 24 points from spot, which is what pinning near expiry should look
  like
- Futures: three expiries, near 24,341.9 with OI 15,370,875 and OI change +359,840
- Participant OI: FII index futures **long 24,157 vs short 226,790** — a real
  institutional-positioning signal, and available historically, unlike `fiidiiTradeReact`
  which only gives the latest day

And against legacy 2020-06-10 NIFTY, expiry 2020-06-11: 88 CE / 88 PE, PCR 0.959. The
same derivation runs on both formats.

One legacy detail that will bite anyone who assumes otherwise: **`OPTION_TYP` is `XX` for
futures rows**, not blank or null, and there is a trailing `Unnamed: 15` column. The
participant-OI file has a quoted title on line 1 with the real header on line 2, and
several column names carry trailing spaces.

### Scope, stated

Built here: both bhavcopy parsers, the canonical contract frame, the derived metric row,
the historical backfill, participant-wise OI, delivery percentage, FII/DII latest, and the
live chain as a top-up.

**Not built here:** per-contract Greeks and a fitted volatility surface (needs a rate and
dividend curve to be more than decoration); intraday option-chain snapshots on a timer
(that is a data-collection service, not a feature, and it needs master's decision on
whether Rāma should hold a market-hours process open); BSE derivatives.

---

## SECTION 68 — StockMind: outcome recording, and the learning loop that was never connected

Task 3 of the six-part StockMind build.

*Written before implementing, per Section 28's working agreement.*

### What was actually wrong

`ModelRegistry.update_from_outcome` exists. `StackingMetaLearner.update` exists and
implements a real softmax-over-EMA-performance reweighting. `compute_ece` and
`compute_brier_score` in `calibration.py` are correct implementations.

**Nothing calls any of them.** Three consequences, none of them visible from the outside:

1. `_meta.weights` are initialised to `np.ones(n) / n` and **stay uniform for the life of
   every process**. The "stacking meta-learner" is an unweighted mean wearing a
   learned-weights interface. Its `"capabilities"` list advertises `"online_learning"`.
2. `/health` reports `ece: null` and `calibrationMeasured: false`. That is honest as of
   Section 64 — but it is honest about a measurement that had no route to ever being
   taken.
3. **`adaptiveWeight` is a *request parameter*.** The caller is asked to supply the
   number that is supposed to come out of the engine's own measured history, and the UI
   sends the default 1.0. The learning signal enters from the outside, which is exactly
   backwards, and it is the shape you get when learning state cannot survive a restart.

That third point is the real one. `MODEL_REGISTRY` is an in-memory singleton in a process
`aiProcess.cjs` spawns and respawns. **Even if `update_from_outcome` were called, every
weight it learned would die with the process.** So the loop cannot be closed by adding a
call; it needs persistence, and that is why this is a section rather than a one-line fix.

### The shape of the problem

A prediction is a claim with a deadline. Learning from it requires three separate moments
in time, and the gap between them is the entire difficulty:

    record the claim  →  wait for the bars  →  score it, then learn

Nothing in the engine spanned those moments. `/predict` returned and forgot.

### Decision 1 — the resolver reuses the backtest's simulator

This is the load-bearing decision.

`backtest._simulate_np` already encodes the outcome rules Section 66 settled: the stop is
assumed hit first on intrabar ambiguity, `TIMEOUT` is marked to market rather than booked
as a stop-loss, each target is credited at its own level. The resolver calls **that
function**, not a second implementation of the same idea.

If live outcomes were resolved by different rules than backtested ones, the two sets of
numbers would not be comparable — and comparing them is the only way to find out whether
the backtest predicts live behaviour. Two implementations would also drift, and the drift
would be invisible: both would keep producing plausible win rates.

### Decision 2 — one claim per bar per variant, deduplicated

**Without this the measurement is worthless.** If the UI polls `/predict` every few
seconds, the same bar produces hundreds of near-identical predictions. Recording each one
would count a single claim hundreds of times, and ECE — an average over predictions —
would be dominated by whichever bar was polled most.

So a record's identity is `(symbol, instrType, barDate, variant)`. A repeat prediction for
the same bar **updates** the existing record instead of appending a new one. The number of
recorded claims then equals the number of distinct claims, which is what every statistic
computed over them assumes.

### Decision 3 — JSONL for records, not the CSV store

Section 65 chose CSV and Section 67 reused it. This does not, deliberately.

The store holds **time series**: one row per date, fixed columns. Outcome records are
**events**: several per day, each carrying a nested `model_probs` dict and a reference to a
100-float feature vector. Forcing that into CSV means either 100+ columns or JSON embedded
in a cell, and the latter is a CSV that is not really a CSV.

JSONL is append-only, line-atomic, and crash-safe in the way that matters here: a torn
final line is discarded on read and the rest of the file is intact. Rewrites go through a
temp file and `os.replace`, as the store does.

### Decision 4 — the feature vector is stored once per prediction, not once per signal

Section 64 established that N signals are N risk-geometry variants of **one** prediction.
They therefore share one feature vector and one set of model probabilities.

Storing the vector per signal would multiply it by the variant count for no information —
at 100 floats and 16 variants that is 1,600 floats where 100 will do. Records reference a
`predictionId`; the vector is written once under that id.

### Decision 5 — learning is exactly-once, and persisted

Each record carries `resolved` and `learnedAt`. `update_from_outcome` is called only for
records that are resolved and not yet learned, and `learnedAt` is stamped immediately.

Re-running the resolver is therefore safe. Without that, whoever runs it twice silently
doubles every outcome's influence on the weights, and there is no way to detect it
afterwards — the weights are just wrong.

The meta-learner's `weights`, `perf_ema` and `_update_count` are persisted and restored at
startup. This is what makes the loop real rather than per-process theatre.

### Decision 6 — never learn from synthetic data

`dataSource` is already `"mock"` when `get_ohlcv` fell back to a seeded random walk.

Those predictions are **recorded** — they are real outputs and hiding them would make the
record incomplete — but they are never resolved against price and never fed to the
learner. Training the ensemble to predict a random walk is worse than not training it: it
would produce confident weights derived from noise, and `/health` would then report a
measured calibration for a model calibrated against nothing.

### Decision 7 — `adaptiveWeight` becomes measured, with the parameter as an override

The engine computes it from its own resolved history and uses that. The request parameter
is honoured when supplied explicitly, so no existing caller breaks (I11), but the default
stops meaning "1.0 forever".

The measured value is a **calibration correction**: the ratio of realised win rate to mean
predicted probability over resolved records, clamped to the same `[0.5, 2.0]` the schema
already validates. It is only applied once there are enough resolved outcomes to mean
anything (`MIN_SAMPLES_FOR_WEIGHT`), and until then it is exactly 1.0 and says so. A
correction fitted on nine trades is noise with a decimal point.

### Known distortion this exposes, recorded rather than fixed here

`dispatcher._apply_mode` adds `np.random.normal(0, 0.03)` to the probability in
`"learning"` mode, and `"both"` — the default — blends 40% of that noisy value.

So **the default prediction path is not reproducible**: the same bar and the same features
give a different probability on each call. For a "learning/exploration" mode that is a
defensible choice, but it means the recorded probability is the perturbed one, and
measured ECE will include that injected variance as if it were model miscalibration.

The recorded value is therefore the probability **actually issued** (perturbation
included), because that is the claim that was made and the only one it is fair to score.
`rawProbability` is recorded alongside it so the two can be separated later. Removing the
noise from the default path is a behaviour change master has not asked for, so it is
flagged here rather than done quietly.

### What is built

- `ai_backend/engine/outcomes.py` — record, resolve, learn, and the measured statistics.
- `registry.py` — persist and restore meta-learner state; expose `measured_adaptive_weight`.
- `dispatcher.py` — records every prediction, via an optional context argument so the four
  signal builders keep working unchanged.
- `health.py` — reports measured ECE and Brier once outcomes exist, and keeps reporting
  `null` with `calibrationMeasured: false` until they do.
- Routes: `GET /outcomes`, `POST /outcomes/resolve`, `GET /outcomes/stats`,
  `POST /outcomes/learn`.

### Not built here

No automatic resolution on a timer — that is a scheduling decision for the Electron side
and belongs with the UI wiring, not the engine. No retraining of base models from
outcomes; that is task 4, and it needs master's horizon answer. The online SGD update is
wired but stays skipped while no base model has a fitted artifact to update.

---

## SECTION 69 — StockMind: training real models, and the contract that keeps them aligned

Task 4 of the six-part StockMind build.

*Written before implementing, per Section 28's working agreement.*

### The state before this

Every model in `models.py` has a `_try_load` that looks for an artifact under
`ai_backend/data/models/` and, finding none, constructs an unfitted estimator and falls
back to a hand-written heuristic. **That directory does not exist.** So every probability
StockMind has ever produced came from the heuristic branch, which Sections 64 and 68 made
`/health` say honestly.

There has never been a training script.

### The trap that would have made this worse than useless

**There is no feature scaling anywhere at inference.** `predict_proba` does
`self.model.predict_proba(features.reshape(1, -1))` on the raw vector.

Two of the three trainable models here — MLP and SGD — are scale-sensitive. Training them
on standardised features and then serving raw features would produce confident nonsense.
And it would be **silent**: `predict_proba` only falls back to the heuristic on an
*exception*, never on an implausible output. `/health` would report a trained artifact,
grades would look normal, and the numbers would be meaningless.

**Decision: the scaler travels inside the artifact.** Each sklearn model is persisted as a
`Pipeline(StandardScaler, estimator)`, so `joblib.load(...).predict_proba(raw_vector)`
scales internally. **No inference code changes**, the artifact is self-contained, and it is
impossible to load the model without its scaler because they are one object. Tree models
(LightGBM, XGBoost) are scale-invariant and keep their native formats.

### Decision — the feature manifest is the contract

A model is a function of a **vector position order**. `compute_full_features_dict` returns
100 features today; if a feature is ever added, removed or reordered, every column shifts
and a loaded model silently predicts from misaligned inputs.

This is the third time the same failure class has appeared in this codebase: Section 64's
37 feature names zipped against a 59-value vector, and Section 68's positional
meta-learner weights that had to be refused rather than padded. So it is handled the same
way, by refusing rather than guessing.

`data/models/featureset.json` records the exact feature names, their order, the featureset
version, and whether derivative columns are included. On load, each model **validates its
artifact against the live feature builder**. On mismatch the artifact is rejected, the
model falls back to its heuristic, and the reason is logged and surfaced in `/health`.
Predicting from a misaligned vector is strictly worse than not predicting.

**One builder serves both training and inference.** `featureset.build_feature_map` is
called by the trainer and by the dispatcher. Two code paths assembling "the same" vector is
how alignment rots.

### Decision — the label is the sign of the forward return, with no neutral band

The model's output is consumed by `dispatcher.barrier_probability(directional_prob, reward,
risk)`, which converts a **directional edge** into a barrier-hit probability. So the model
must produce P(up over the horizon), unconditionally.

A common refinement is to drop small moves and label only `|return| > k·ATR`. That is
rejected here: it trains P(up | the move was large) and the engine would consume it as
P(up), which **overstates the edge** on exactly the quiet bars where the model should be
least confident. The threshold variant is available as a parameter, defaulting off, with
this reason recorded next to it.

Labels are built from the **forward** return and are therefore only defined for bars that
have `horizon` bars after them. The last `horizon` rows are dropped, not filled.

### Decision — the horizon is recorded in the artifact

Master has been asked four times whether the target is intraday, swing-days or
positional-weeks, and has not answered. Rather than block, the horizon is a first-class
parameter, **default 5 bars** (swing), and it is written into the artifact's provenance.

The safety property that matters: **a model trained for one horizon can never be silently
used as though it were trained for another.** When master answers, changing the default
retrains rather than reinterprets, and any stale artifact is visibly for a different
horizon.

### Decision — strict forward-chaining splits, and an untouched holdout

No `KFold`, no shuffling. Market data is ordered and any shuffled split lets the model see
the future.

Splits are forward-chaining — train on `[0, k)`, validate on `[k, k+v)`, advance — and the
final segment of the series is a **holdout that no fold touches**. Reported metrics are
holdout metrics. Train and holdout **date ranges** are recorded, so
`backtest._trained_model_note()` can finally answer whether a backtest window overlaps the
training data instead of returning `"unknown"`.

### Decision — refuse to persist a model that does not beat its base rate

Accuracy alone hides the only thing that matters at this stage. A series that rose on 54%
of days makes "always up" a 54% classifier, and a model scoring 52% is **worse than a
constant** while looking like a working model.

So training reports the majority-class base rate beside every score, and **a model is not
written to disk unless it beats that base rate on the holdout** by a stated margin. The
alternative is that `/health` starts reporting a trained artifact whose predictions are
worse than the heuristic it replaced — the exact outcome Sections 64 and 68 were about.

A refusal is reported as a result, not an error. "Nothing beat the base rate" is a true and
useful answer about this data.

### Decision — derivative features are constant-width, neutral-filled, and flagged

Section 67 stores option and future metrics per symbol-day, but only for NSE F&O symbols
and only for dates that have been backfilled. A model needs a fixed input width, so the
columns cannot appear and disappear.

When derivatives are enabled the columns are always present. Where a bar has no metric row
they are filled with a neutral constant and `deriv_available` is `0`, so the model can
learn to discount them rather than being fed NaN — which sklearn rejects outright.

Enabling them changes the vector from 100 columns to wider, which will trigger the
online-SGD width reset built in Section 68. That was predicted there and is the first real
exercise of it.

### What is built

- `ai_backend/engine/featureset.py` — the one feature builder, the derivative join, and the
  manifest that is the contract.
- `ai_backend/engine/training.py` — labels, forward-chaining splits, fitting, holdout
  evaluation, the base-rate gate, artifact and provenance writing.
- `ai_backend/train.py` — a CLI so master can retrain without the app running.
- `models.py` — manifest validation on load; artifacts refused rather than misapplied.
- `dispatcher.py` — assembles features through the shared builder.
- `backtest.py` — `_trained_model_note` reports the real training range and in-sample overlap.
- Routes: `POST /train`, `GET /models`.

### Not built here

No LSTM: `torch` is not in `requirements.txt` and adding it is a large pinned dependency
master has not asked for; `LSTMModel` keeps its heuristic and reports why. LightGBM and
XGBoost training **is** implemented but cannot be exercised in this workspace — neither
package installs here — so those paths are written, skipped cleanly, and reported as
unverified rather than claimed. No hyperparameter search; the existing architectures are
kept so this change is about correctness of the pipeline, not about squeezing the models.

### The gate, and the two times it was wrong before it was right

The acceptance criterion took three attempts, and each failure was found by running it
rather than by reading it. This is recorded in full because the gate is the only thing
standing between a meaningless model and `/health` reporting a trained artifact.

**Attempt 1 — raw accuracy against the majority class.** Wrong for two reasons. NIFTY rose
over 5 bars on 56% of the sample, so "always up" scores 0.56 and raw accuracy mostly
measures the index's drift. And `RandomForestClassifier(class_weight='balanced')` optimises
*balanced* accuracy — it deliberately refuses to exploit the prior — so judging it against a
majority-class baseline compared two different objectives and it could never win. Removing
`class_weight='balanced'` lifted RF's accuracy from 0.4943 to 0.5376 and halved its ECE:
balancing distorts predicted probabilities away from the true prior, which is right when the
two errors cost differently and wrong when the probability itself is the product.

**Attempt 2 — AUC plus Brier skill.** Better: AUC is invariant to the class prior, and Brier
skill against climatology tests whether the probabilities beat always predicting the
historical up-frequency. But Random Forest then scored holdout AUC **0.5974 while its
forward-chaining folds averaged 0.4821 — below chance**. Accepting that is exactly the error
walk-forward validation exists to catch: one final segment looked good while every earlier
one did not. Added a fold-stability condition.

**Attempt 3 — and a random walk passed.** A synthetic pure random walk scored holdout AUC
**0.7464** with Brier skill +0.12 and cleared all three conditions. Its holdout was **47
rows**, where the standard error of AUC is about 0.10, so 0.75 is unremarkable noise. The
gate was measuring sample size, not skill. Two guards added: a hard floor of 150 holdout
rows, and a requirement that AUC clear 0.5 by two standard errors, computed from the
**minority** class because that is what limits precision. Re-run on an adequately sized
random walk, AUC was 0.516 against a significance floor of 0.593 — correctly rejected.

The final gate is five conditions, all of which must pass: holdout size, AUC above 0.52, AUC
above the significance floor, Brier skill above zero, and mean fold AUC at least 0.50. It
lives in one function, `gate_verdict`, because `train` and `sweep_horizons` both need it and
the sweep's first version checked only two conditions — so it reported horizons as passing
that the trainer would have refused.

### The measured result: no directional edge, at any horizon tested

Master has been asked four times which horizon to target, so the tool now answers with
measurements. `sweep_horizons` featurises once and relabels per horizon, since features do
not depend on the horizon and rebuilding the dataset per horizon would cost N times as much
for identical inputs.

NIFTY 50, 2,185 rows (stride 2), 100 price/volume features, 2008-10-03 → 2026-07-31, Random
Forest, 437-row holdout:

| Horizon | Up rate | AUC | Sig. floor | Brier skill | Fold AUC | Accuracy | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 0.529 | 0.518 | 0.568 | −0.006 | 0.553 | 0.520 | rejected |
| 2 | 0.541 | 0.520 | 0.570 | −0.005 | 0.513 | 0.536 | rejected |
| 3 | 0.552 | 0.527 | 0.570 | −0.002 | 0.518 | 0.547 | rejected |
| 5 | 0.565 | 0.508 | 0.571 | −0.006 | 0.518 | 0.542 | rejected |
| 10 | 0.584 | 0.550 | 0.573 | +0.005 | 0.501 | 0.558 | rejected |
| 20 | 0.611 | **0.597** | 0.577 | **+0.030** | **0.487** | 0.629 | rejected |

**No horizon from 1 to 20 bars carries a measurable directional edge**, and each is rejected
for a different, specific reason: 1, 2 and 5 fail AUC outright; 3 and 10 rank above chance
but not beyond two standard errors; 20 clears AUC, significance *and* Brier skill but fails
fold stability at 0.487 — its apparent skill is that holdout segment's regime.

Two things worth stating about this table. There **is** a monotonic trend: signal rises with
horizon, which is consistent with longer-horizon index returns being more drift-dominated
and therefore more forecastable. And the 20-bar labels overlap heavily — at stride 2,
consecutive rows share 18 of their 20 forward bars — so the effective sample is far smaller
than 437 and the AUC has a wide interval. That is the standard overlapping-label problem in
financial ML and it is a reason to trust 0.597 less, not more.

`DEFAULT_HORIZON` therefore stays at 5. Nothing in the sweep justifies moving it, and moving
it on the strength of a result that fails the gate would be exactly the self-deception this
section is built to prevent.

**This is a finding about the data and the current feature set, not a defect.** Directional
prediction of a broad index from price and volume alone is close to a martingale, which is
the well-documented prior. It points at what the next tasks are actually for: the Section 67
derivative features (positioning, not price), news and sentiment (task 5), and possibly a
different target — realised volatility is far more forecastable than direction, and the risk
geometry already consumes it.

### Verified

- 580 assertions across six suites, `test_training.py` contributing 112.
- Because real data yields no acceptable model, the persist/load path is proved on a
  synthetic trending series (AUC 0.982, Brier skill 0.775, fold AUC 0.976) — otherwise
  "nothing persisted" and "persisting is broken" would be indistinguishable.
- End to end through the API: `/models` reports no contract before training; `/train
  dryRun` accepts without writing; `/train` persists, reloads in place and reports
  `newlyTrained`; `/models` then shows `type: "trained"` with the horizon; `/health` moves to
  `modelsLoaded: 1`; `/predict` serves from the artifact; and **`/backtest` reports
  `outOfSample: false` with an explicit IN-SAMPLE warning** naming both date ranges, which is
  the capability `_trained_model_note` could not provide before.
- A missing symbol returns 400 with the reason, not 500.

### Two robustness fixes made along the way

`os.replace` raises `PermissionError` on Windows when anything holds a handle on the
destination for an instant — an antivirus scan of the file just written is enough, and it
surfaced as soon as several test processes wrote outcome files at once. `_rewrite_jsonl` now
retries with a short backoff; on POSIX the rename would simply have succeeded, so this is a
platform difference rather than a logic error. And `_prune` no longer propagates: retention
is housekeeping, and a failed prune means a file slightly larger than intended while a
propagated error would lose a prediction record that had already been assembled.

---

## SECTION 70 — StockMind: news, and what it can honestly be used for

Task 5 of the six-part StockMind build. Master's requirement: "read the news, reports of
stocks and generate impact on index, stocks and derivatives, commodities."

*Written before implementing, per Section 28's working agreement.*

### The defect this starts from

`SentimentModel.predict_proba_from_features` returns:

```python
return float(np.clip(0.5 + np.random.normal(0, 0.04), 0.35, 0.65))
```

**Pure noise.** And that is the branch taken on every single prediction, because
`registry.ensemble_predict` only calls the text path when `news_text` is non-empty and
nothing has ever supplied it. `predict_proba` with no pipeline and no text is the same:
`0.5 + np.random.normal(0, 0.05)`.

So **one of the eight ensemble members is a random number generator**, and it has been
voting in `_meta.blend` on every request. It also makes `epistemic` — the standard deviation
across model probabilities — **non-reproducible**: two identical requests report different
model disagreement, and part of what they report is a member disagreeing only with itself.

That is the concrete thing to fix here, independent of anything news adds.

### What was probed, and what is actually true

| Source | Items | Distinct days | Verdict |
|---|---|---|---|
| Google News RSS search | 100 | 10–16 | **works**, per-query, carries publisher name |
| Economic Times markets | 50 | 2 | works |
| The Hindu BusinessLine markets | 60 | — | works |
| Business Standard markets | 35 | — | works, richest tags (category, keywords, section) |
| Livemint markets | 35 | — | works |
| Yahoo Finance per-ticker | 15 (AAPL) | — | **US only** |
| Moneycontrol business | 15 | — | **stale by over two years** |

Two traps worth recording, because both look like success:

**Yahoo's per-ticker feed returns zero items for Indian symbols.** `RELIANCE.NS` and `^NSEI`
both return HTTP 200 with well-formed XML containing no `<item>` elements, while `AAPL`
returns 15. The obvious per-ticker source for an Indian tool silently has nothing.

**Moneycontrol's feed is over two years stale.** It answers 200, the XML parses, the items
are well-formed — and the newest is from April 2024. This is the failure mode that passes
every check anyone writes by reflex. So every source is **staleness-checked on the age of
its newest item**, and one that is too old is reported as stale rather than merged.

### The constraint that decides everything: news has no history

**No feed reaches back more than about 16 days**, and most cover two. Google News with
`when:30d` still returned only 16 distinct days.

This is the opposite of Section 67's situation, where the NSE archives went back to 2001. It
means:

- **News features cannot be backfilled.** They can only be accumulated forward, one day at a
  time, starting whenever collection starts.
- **Therefore news cannot be a trained-model feature today.** Section 69 requires a 150-row
  holdout and forward-chaining folds; with 16 days there is nothing to fit and nothing to
  validate on. Claiming a news-driven edge now would be unmeasurable by construction.

So the honest deliverable is three things, and explicitly not a fourth:

1. **Collect and persist daily**, so that in some months the feature becomes trainable. The
   store already refuses to shrink and de-duplicates on date (Section 65), which is exactly
   what an accumulating series needs.
2. **Surface it as context now.** A trader reading "why is this moving?" is served by
   headlines, classified events and a polarity reading, and that is useful without any claim
   of predictive power. This is most of what master asked for.
3. **Wire it as a feature behind the availability flag**, so when coverage exists the
   Section 69 gate — unchanged — decides whether it adds anything.
4. **Not** asserting impact. Task 4 established there is no measurable directional edge from
   price features; asserting one from headline sentiment, on 16 days of data, would be
   exactly the self-deception the last four sections have been removing.

### Decision — a lexicon, not a language model

`transformers` + `torch` is a very large pinned dependency (I12) that master has not asked
for, and FinBERT on CPU is slow enough to matter per request. The existing FinBERT path is
**kept** and used when `transformers` happens to be installed (I11, additive), but the
default is a compact financial lexicon written in-code.

It is a lexicon and is labelled as one. Specifically it handles the three things that make
naive word counting wrong on financial headlines:

- **Negation**: "fails to beat estimates", "not profitable" — a polarity word inside a
  negation window flips.
- **Finance-specific polarity**: "beat", "upgrade", "buyback", "order win" are positive;
  "miss", "downgrade", "probe", "impairment", "stake sale" are negative. General-purpose
  sentiment lists get these wrong or miss them entirely.
- **Intensity**: "surges" and "edges up" are not the same claim.

No licence question, no dependency, and it can be read and corrected by hand.

### Decision — event type matters more than polarity

A polarity score on a headline is weak. The *kind* of event is both more robustly detectable
and more actionable: earnings, guidance, rating change, regulatory or legal, M&A, dividend or
buyback, block or bulk deal, index inclusion, macro.

Classification is keyword-pattern based and reported alongside sentiment, because "three
rating downgrades today" tells a trader something that "sentiment −0.2" does not.

### Decision — the sentiment member abstains instead of guessing

When there is no news for a symbol, `SentimentModel` returns **`None`**, and
`registry.ensemble_predict` **omits it from the ensemble** rather than inserting 0.5 or noise.

A model with nothing to say should not vote. Omitting is safe with the existing blend because
sentiment is the **last** slot (`_base_models + ["sentiment"]`), so a shorter value list still
lines up with `weights[:len(values)]` — the positional hazard from Sections 68 and 69, checked
rather than assumed. `epistemic` and `agreement` then describe only members that actually
had an opinion.

### Decision — relevance weighting, and per-symbol aggregation

A headline naming the symbol is worth more than a general market headline. Each item gets a
relevance score from symbol and alias matches in the title, and the daily aggregate is
relevance-weighted.

Persisted per `(symbol, date)`: item count, relevance-weighted mean sentiment, positive and
negative counts, the dominant event type, an event-type histogram, and the number of distinct
sources — because ten copies of one wire story is not ten pieces of evidence, which is also
why items are de-duplicated on a normalised title before aggregation.

### Not built here

No article-body fetching — RSS gives title and description, and fetching each link would be
slow, fragile and a scraping question master has not been asked. No paid news APIs. No
attempt to attribute a specific price move to a specific headline; that is a causal claim
and this data cannot support it.

### Verified live

All five registered feeds answered fresh, and the two traps behaved exactly as described:

| Source | Items | Newest | Stale |
|---|---|---|---|
| google_news | 100 | 0.05 d | no |
| economic_times | 50 | 0.01 d | no |
| business_standard | 35 | 0.01 d | no |
| livemint | 35 | 0.05 d | no |
| businessline | 60 | 0.01 d | no |
| yahoo_ticker | — | — | skipped, US tickers only |
| moneycontrol *(not registered)* | 15 | **857.8 d** | **yes** |

Moneycontrol's feed is **857 days stale** while returning HTTP 200 with valid, well-formed
XML. The staleness check catches it; "the XML parsed" would not have.

One `POST /news/sync` seeded **28 distinct days spanning 2026-07-03 → 2026-08-29**, because
items are bucketed by their own publication date rather than all stamped today. Re-running
left it at 28 — the store de-duplicates on date, so collection converges instead of
accumulating duplicates. `coverage` reports `trainable: false` and names the number needed.

The sentiment fix is visible end to end. With no news, the voting members are
`['lightgbm', 'lstm', 'mlp', 'online_sgd', 'random_forest', 'regime_aware', 'xgboost']` —
**seven, with `sentiment` absent** rather than eight with one voting noise. Supplying
"Stock surges after upgrade" adds `sentiment: 0.75`, and the member count grows by exactly
one. Repeating the same headline eight times returns the identical number every time, which
is the direct proof the randomness is gone.

A live reading for NIFTY 50: 12 items after de-duplication from 3 distinct sources,
aggregate sentiment +0.375, 6 positive and 2 negative, dominant event `guidance`.

### Three classification bugs the tests caught

All three were ordering or over-matching errors, found by asserting expected labels rather
than by reading the patterns:

1. **"Brokerage downgrades stock, cuts price target" classified as `guidance`.** The greedy
   `targets?` in the guidance pattern claimed "price target" before `rating` could. `rating`
   now precedes `guidance`, and `guidance` no longer matches a bare "target".
2. **"RBI holds repo rate as inflation cools" classified as `regulatory`.** Bare `rbi` was in
   the regulatory pattern, which made **every** monetary-policy story an enforcement story.
   `rbi` removed; SEBI, CCI and NCLT stay, because those appear in news precisely when they
   are acting against someone, and genuine RBI enforcement says penalty, notice or action —
   which `regulatory` already matches.
3. **"not profitable" scored 0.0.** The lexicon had `profit` and `profits` but not
   `profitable`, so the negation had nothing to flip. Added, along with `unprofitable`,
   `profitability`, `insolvency`, `bankruptcy` and several other common forms.

The third is the useful reminder: a lexicon's failure mode is silence, not error. A missing
word reads as neutral, which is indistinguishable from a genuinely neutral headline.

### What master should take from this

News is now collected, classified and readable, and the random number generator is gone from
the ensemble. What is **not** claimed is that any of it predicts price. With 28 days
collected against roughly 800 needed, that question cannot be asked yet, let alone answered.

The one action that matters: **`POST /news/sync` has to run daily.** It is the only way the
series accumulates, since history cannot be fetched. Nothing in Rāma schedules it yet — that
is the same outstanding scheduling decision as `/outcomes/resolve` from Section 68, and both
belong to the Electron side rather than the engine.
