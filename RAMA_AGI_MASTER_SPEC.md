# RĀMA AGI — Master Specification
> Version 1.0 · July 2026 · Author: Krishna Prasad  
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
├── AGI Core          ← Rama brain: all LLMs, web search, code ops, self-improve
├── OS Layer          ← Full system access: filesystem, processes, memory, network
├── App Assimilation  ← Control any installed app via OS automation (no UI needed)
├── Terminal          ← Real embedded PTY terminal (node-pty)
├── Git Sync Bridge   ← Auto push/pull StockMind ↔ GitHub ↔ any machine
├── StockMind Module  ← Full StockMind AI embedded as a panel (all features)
├── File Explorer     ← Navigate/edit any folder with AI operations
├── Knowledge Base    ← Rama's persistent memory, growing knowledge store
└── System Tray       ← Always-on background process, auto-start on login
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

*RAMA_AGI_MASTER_SPEC.md — Generated July 2026*  
*Copy this file into the Rama_AGI workspace root before starting work.*
