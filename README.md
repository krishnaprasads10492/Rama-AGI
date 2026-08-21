# RĀMA AGI
**Righteous Autonomous Master Agent — Supreme Benevolent Desktop AI**

> Standalone desktop application. Installs like Outlook or VS Code.  
> All data encrypted with AES-256-GCM + Argon2id. No plaintext ever written to disk.

---

## Quick Start (Windows)

Double-click **`Rama.bat`** in the project root. It opens a simple menu:

```
  1. Start Rama                          (normal use)
  2. Check readiness to build a setup    (verify, build nothing)
  3. Build installer from source         (installs what is missing)
  4. Diagnose the running environment    (check, fix nothing)
  5. Exit
```

- **First time?** Pick option 1. `node start.cjs` underneath it installs
  missing dependencies, checks ports, and heals what it can automatically —
  you don't need to run `npm install` yourself first.
- **On first launch**: set your master passcode (min 10 chars). This
  passcode encrypts ALL data — store it securely.
- **Want an installable app?** Pick option 2 first — it verifies whether this
  machine can produce a setup worth installing and tells you *which kind* you'd
  get (fully branded installer, installer with an unbranded `.exe`, or a
  portable zip) before you spend ten minutes on it. It changes nothing.
  Then pick option 3 to build. Option 3 reads option 2's verdict and adapts:
  if a step is known to fail on this machine, it skips it rather than failing
  through it.
- **Option 3** needs only source code and Node.js — it checks what's installed,
  installs whatever is missing, builds the renderer, then packages the app.
  Nothing outside the project folder is touched.
- Option 3 *builds* into `dist-electron\`; it does not install anything by
  itself. Building and installing are two separate steps: when it finishes,
  double-click the generated `Rama AGI Setup <version>.exe` from that folder
  the same way you'd run any downloaded installer, and *that* is what puts
  Rāma into Program Files with a desktop shortcut.
- The build also writes a manifest into the app recording what was true when it
  was made, so the installed Rāma can tell an accepted trade-off ("this build
  shipped without a compiled pty") apart from a damaged installation.
- If your machine's security policy blocks the bundled 7-Zip (electron-builder
  needs it for installers), the build says so and produces a **portable zip**
  instead — unzip it anywhere and run `Rama AGI.exe`. Installing a current
  7-Zip machine-wide restores the installer targets automatically.
- Just want to know what your machine can produce, without building?
  `npm run package:check`

Everything below is the same functionality via raw commands, kept for
reference / non-Windows platforms — `Rama.bat` is just a menu in front of it.

### Manual commands (any platform)
```bash
# Install dependencies
npm install

# Start in development mode (Vite + server + Electron)
node start.cjs

# Diagnose only — report problems, change nothing
node start.cjs --diagnose
```

---

## Build Installer (.exe / .dmg / AppImage)

### Prerequisites
- **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (for native modules)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **All platforms**: Node.js 18+

### Add your icon (optional — a placeholder is used otherwise)
Place the Rāma logo PNG in the `assets/` folder:
```
assets/logo-source.png   ← master logo (any resolution, 1024px+ recommended)
```
Then run the icon generator — it creates all formats automatically:
```bash
npm install sharp png-to-ico png2icons --save-dev
npm run icons
```
This generates:
- `assets/icon.ico`   — Windows (multi-size: 256/128/64/48/32/16px)
- `assets/icon.icns`  — macOS
- `assets/icon.png`   — Linux (512×512)
- `public/icon.png`   — Electron tray icon
- `public/favicon.ico`— Browser tab favicon

### Build commands

Self-preparing (installs missing dependencies first — use these on a fresh
clone). Same thing `Rama.bat` option 2 runs:
```bash
npm run package:readiness # verify readiness to build a setup, build nothing
npm run package           # this platform
npm run package:win       # Windows installer (.exe) + portable
npm run package:mac       # macOS DMG
npm run package:linux     # Linux AppImage + .deb
npm run package:check     # quick machine check, build nothing
npm run audit:package     # verify a built app.asar can resolve its dependencies
```

`package:readiness` writes its verdict to `data/system/readiness.json`. The
build reads it, refuses to run if the verdict is `not-ready` (override with
`--force`), and skips steps already known to fail on this machine.

Raw (assumes dependencies are already installed):
```bash
npm run build:win
npm run build:mac
npm run build:linux
npm run build:all        # cross-compile, requires Docker for non-native
```

Output goes to `dist-electron/`. **Building does not install anything** —
run the generated installer from that folder to actually install the app.

Useful flags on the self-preparing path
(`node scripts/buildInstaller.cjs --help` for all of them):

| Flag | Effect |
|---|---|
| `--dry-run` | Check the machine and stop. Builds nothing. |
| `--dir` | Skip installers; produce the unpacked app + a portable zip. |
| `--skip-install` | Fail on missing dependencies instead of installing them. |
| `--skip-renderer` | Reuse the existing `build/` instead of rebuilding it. |
| `--recheck-archiver` | Re-test a 7-Zip that was previously found to be blocked. |

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
