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
| 33 | Genome-change applier | not started | `genome:propose-change` creates a `GENOME` proposal but no applier is registered for that kind, so approval cannot be applied. Next step: register an applier that patches the sealed nucleus via `nucleusSealer.patchNucleus` and requires a restart. |
| 34 | Resume protocol itself | done | This section, plus `.kiro/steering/rama-resume-protocol.md` (`inclusion: always`) so a cold session loads it without being told. |
| 35 | Key material excluded from git | done | `.gitignore` now covers `data/`, `*.enc`, `rama.salt`, `rama.verify`, `.nucleus.enc`, `.nucleus.salt`. Committing any of them would enable an offline attack on the passcode. |

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
