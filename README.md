# RĀMA AGI
**Righteous Autonomous Master Agent — Supreme Benevolent Desktop AI**

> Standalone desktop application. Installs like Outlook or VS Code.  
> All data encrypted with AES-256-GCM + Argon2id. No plaintext ever written to disk.

---

## Quick Start (Development)

```bash
# 1. Install dependencies
npm install

# 2. Start in development mode (Vite + server + Electron)
node start.cjs

# On first launch: set your master passcode (min 10 chars)
# This passcode encrypts ALL data — store it securely
```

---

## Build Installer (.exe / .dmg / AppImage)

### Prerequisites
- **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (for native modules)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **All platforms**: Node.js 18+

### Add your icon (required before distributing)
Place these files in the `assets/` folder:
- `assets/icon.ico`  — Windows (256x256 minimum, ideally multi-size)
- `assets/icon.icns` — macOS (512x512)
- `assets/icon.png`  — Linux (512x512)

### Build commands
```bash
# Windows installer (.exe) + portable
npm run build:win

# macOS DMG
npm run build:mac

# Linux AppImage + .deb
npm run build:linux

# All platforms (cross-compile, requires Docker for non-native)
npm run build:all
```

Output goes to `dist-electron/`.

### What the installer does (Windows)
- Installs to `Program Files\Rama AGI\` (or user-chosen path)
- Creates Desktop shortcut + Start Menu entry
- Registers `rama://` deep link protocol
- Optionally starts with Windows login (configurable in Settings)
- Full uninstaller included

---

## Architecture

```
node start.cjs
  ├── node server/index.cjs     (Express API :4097)
  ├── npx vite                  (dev only — :5173)
  └── electron .
        ├── electron/main.cjs   (window, tray, IPC)
        ├── electron/preload.cjs (contextBridge)
        └── src/                (React app)
```

### Key files
| File | Purpose |
|------|---------|
| `electron/main.cjs` | Electron entry — window, tray, auto-updater |
| `electron/preload.cjs` | Secure IPC bridge (contextBridge) |
| `electron/cryptoCore.cjs` | AES-256-GCM + Argon2id encryption engine |
| `electron/dataStore.cjs` | Encrypted persistent data (7 domains) |
| `electron/sessionManager.cjs` | Session lifecycle, ephemeral keys |
| `electron/resourceOrchestrator.cjs` | Dynamic multi-resource scheduler |
| `server/index.cjs` | Express API server |
| `src/App.jsx` | React router + auth gates |

---

## Pages / Routes

| Route | Page | Access |
|-------|------|--------|
| `/` | Chat | All users |
| `/home` | Dashboard | Viewer+ |
| `/system` | System Monitor | Operator+ |
| `/terminal` | PTY Terminal | SuperAdmin+ |
| `/git` | Git Sync | Operator+ |
| `/agents` | Agent Control | Operator+ |
| `/models` | Model Router | SuperAdmin+ |
| `/intel` | Intelligence Engine | Operator+ |
| `/ide` | Rāma IDE | All users |
| `/evolution` | Self-Evolution | Master only |
| `/resources` | Resource Orchestrator | Operator+ |
| `/mind` | AGI Dashboard | Master only |
| `/users` | User Management | Admin+ |
| `/settings` | Settings | Admin+ |
| `/stockmind` | StockMind AI | Viewer+ |
| `/knowledge` | Knowledge Base | Viewer+ |

---

## Security

- Master passcode → Argon2id (128 MiB, 4 iter) → AES-256-GCM key
- All data files: `.enc` format = `[version|kdf|salt|IV|authTag|ciphertext|HMAC]`
- Session key: ephemeral 32-byte buffer, zeroed on exit
- Vault: HMAC-SHA512 integrity check on every read
- No plaintext ever written to disk
- Without the passcode: every file is indistinguishable from random bytes

---

## GitHub
- Repo: `krishnaprasads10492/Rama-AGI`
- Stable: `source` branch
- Dev: `dev` branch
