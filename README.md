# Sweet Creative Inventory

Desktop app (Mac + Windows) for The Sweet Creative balloon boutique. Pulls paid orders from Stripe + every BYO submission from Netlify Forms, deducts stock by recipe (designs / finishes / palettes / add-ons), and surfaces low-stock alerts before you run out.

## What it does

- Inventory tracking with full audit trail of every movement
- Catalogue: 9 designs · 3 finishes · 19 palettes · 54 add-ons · 39 bundles (auto-imported from `product-data.js`)
- Recipes per catalogue entry — palette = balloons consumed, finish = ribbons/toppers consumed, etc.
- **Stripe sync** every 5 minutes — paid Checkout Sessions become orders
- **Netlify Forms sync** every 5 minutes — failsafe so no order ever slips when Stripe lags or fails
- **Manual orders** for phone / market / in-person sales
- **Mark paid** workflow when you've verified payment via bank statement
- Auto-detects refunds from Stripe and prompts to reverse stock
- Encrypted secret storage (Windows DPAPI / macOS Keychain)
- Dashboard, audit log, low-stock toasts, backup / reset

---

## For the end user (Jade): installing

1. Double-click the `.exe` installer.
2. Windows may show "Windows protected your PC" — click **More info** → **Run anyway** (one-off).
3. Pick an install location and finish the wizard.
4. Launch from the Start menu.
5. The first-launch **Setup wizard** walks you through Stripe → Netlify → catalogue import. About three minutes. You can skip any step and finish later in Settings.

The app stores everything locally in `%APPDATA%\sweet-creative-inventory\inventory.db`. Back it up from **Settings → Backup & data** once a week.

---

## For the developer (you): building the installer

### Prerequisites

| Tool | Why | How |
|---|---|---|
| **Node.js 20+** | JS runtime | Already installed (the dev box has v24, v22 LTS works too) |
| **Python 3** | `node-gyp` needs it to compile `better-sqlite3` against Electron's native ABI | `winget install Python.Python.3.12` |
| **Visual Studio Build Tools** | The actual C++ compiler | [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/) → "Tools for Visual Studio" → "Build Tools for Visual Studio" → **Desktop development with C++** workload (~3 GB) |

### Run in dev (no native compile needed)

```bash
npm install --ignore-scripts
node ./node_modules/electron/install.js
cd node_modules/better-sqlite3 && node ../prebuild-install/bin.js --runtime=electron --target=31.6.0
cd ../..
npm run dev
```

### Type-check

```bash
npm run typecheck
```

### Package a Windows installer

After installing Python + VS Build Tools above:

```bash
npm install              # full install — runs prebuild scripts this time
npm run rebuild          # rebuilds better-sqlite3 against Electron's ABI
npm run package:win      # produces dist/Sweet Creative Inventory-0.1.0-Setup.exe
```

The installer is per-user (no admin required) by default — change `nsis.perMachine` in `electron-builder.yml` if you want machine-wide installs.

### Package for Mac

```bash
npm run package:mac      # produces dist/Sweet Creative Inventory-0.1.0-arm64.dmg
```

Without an Apple Developer ID, Gatekeeper will warn the first run. Right-click the app → Open → Open works around it.

### Code-signing (optional, recommended for distribution)

- **Windows**: ~$300/yr from a CA (DigiCert, SSL.com). Without it, SmartScreen shows "Windows protected your PC" once. Configure via `signtoolOptions` in `electron-builder.yml`.
- **Mac**: $99/yr Apple Developer ID. Configure via env vars `CSC_LINK` + `CSC_KEY_PASSWORD`.

### Auto-update (optional, recommended)

Currently disabled (`publish: null` in `electron-builder.yml`). To enable:

1. Push the project to a GitHub repo (private is fine).
2. Uncomment the `publish:` block in `electron-builder.yml`, set your `owner` / `repo`.
3. Generate a GitHub personal access token with `repo` scope; set `GH_TOKEN` env var.
4. Run `npm run package:win -- --publish always` — uploads to a GitHub Release.
5. The installed app will check for updates on every launch and silently install on quit.

---

## Where data lives

- **Database**: `%APPDATA%\sweet-creative-inventory\inventory.db` (Windows) or `~/Library/Application Support/sweet-creative-inventory/inventory.db` (Mac). WAL files (`*.db-shm`, `*.db-wal`) live next to it. **Don't put this folder in OneDrive/Dropbox** — concurrent file syncing corrupts SQLite WAL.
- **Logs**: `%APPDATA%\sweet-creative-inventory\logs\inventory.log`
- **Secrets** (Stripe key, Netlify token): inside the database, encrypted with `safeStorage` (Windows DPAPI / macOS Keychain — only the local user account can decrypt them).

---

## Phase status

1. ✅ Phase 1 — Skeleton + Inventory
2. ✅ Phase 2 — Catalogue + recipes
3. ✅ Phase 3 — Stripe ingestion + manual confirm
4. ✅ Phase 4 — Netlify Forms failsafe + manual orders
5. ✅ Phase 5 — Dashboard + low-stock + audit log + auto-refund + backup
6. ✅ Phase 6 — Brand styling + first-run wizard + packaging + auto-update wiring
