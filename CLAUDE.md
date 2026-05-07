# CLAUDE.md — Notes for AI agents working on this repo

This file is read automatically by Claude Code (and similar tools) when a
session starts in this directory. It describes the project, the dev/ship
workflow, and the gotchas you would otherwise rediscover the hard way.

---

## What this is

**Sweet Creative Inventory** — Electron desktop app (Mac + Windows) for a
balloon boutique. Tracks inventory, syncs paid orders from Stripe + Netlify
Forms, deducts stock by recipe.

**Stack:**
- Electron 31 + electron-vite (build tooling)
- React 18 + TypeScript + Tailwind CSS + shadcn-style UI (Radix)
- tRPC for main↔renderer IPC
- better-sqlite3 for local persistence
- electron-updater + electron-builder for distribution

**Local data location** (per-Mac, NOT in repo):
`~/Library/Application Support/sweet-creative-inventory/inventory.db`

---

## The two-Mac workflow

This repo is developed across multiple Macs. Updates are shipped via GitHub
Releases — there is no auto-updater wired up yet (see "Known issues" below).

### On the dev Mac (where code changes happen)

```
npm run dev               # live dev with hot reload
npm run typecheck
npm run test
npm run package:mac       # local build into ./dist/ (sanity check only)

# When ready to ship a new version to the other Mac:
./scripts/bump-and-ship.sh           # patch bump (0.3.5 -> 0.3.6)
./scripts/bump-and-ship.sh minor     # or minor / major / explicit
```

`bump-and-ship.sh` runs `npm version`, pushes the commit and the tag, and
the GitHub Actions workflow (`.github/workflows/build-mac.yml`) sees the
tag push, builds DMGs, and publishes a GitHub Release with them attached.

### On the receiving Mac (where the app gets installed/updated)

One-time setup:

```
brew install gh
gh auth login                                          # browser flow
gh repo clone Blake1280/MacApp-TSC ~/Code/sweet-creative-inventory
cd ~/Code/sweet-creative-inventory
chmod +x scripts/*.sh
```

To install or update the app at any time:

```
./scripts/update-from-release.sh           # latest release
./scripts/update-from-release.sh v0.3.6    # specific tag
```

That script downloads the right DMG (arm64 vs x64 auto-detected), mounts
it, replaces `/Applications/Sweet Creative Inventory.app`, removes the
quarantine flag, and unmounts. Safe to run repeatedly.

---

## Working in dev mode

```
npm install                        # only when package.json changes
npm run rebuild                    # IMPORTANT — see gotcha below
npm run dev                        # spawns Electron with HMR
```

After every `npm install` that touches a native module (right now: only
`better-sqlite3`), you MUST run `npm run rebuild` before `npm run dev`,
otherwise Electron will fail to load the module with `NODE_MODULE_VERSION`
mismatch (Node's ABI ≠ Electron's ABI).

The rebuild step is `electron-builder install-app-deps` under the hood. CI
already does this — only matters locally.

---

## Project layout

```
src/
  main/        Electron main process — IPC, services, sync, DB
  preload/     Preload bridge
  renderer/    React UI
  shared/      Code shared between main and renderer
resources/     Icons + first-run seed data
tests/         Vitest tests (run with `npm run test`)
scripts/
  bump-and-ship.sh         Dev side — bump version, tag, push
  update-from-release.sh   Receiver side — fetch + install latest DMG
.github/workflows/
  build-mac.yml            CI: builds DMGs on every push, publishes
                           GitHub Release on tag push
```

---

## Known issues / unfinished work

1. **Auto-updater is broken.** On startup the app logs:
   ```
   Auto-updater not active { reason: "TypeError: Cannot set properties of
   undefined (setting 'logger')" }
   ```
   Source: somewhere in the `electron-updater` setup in `src/main/`.
   Until this is fixed, every update requires running
   `update-from-release.sh` manually on the receiving Mac.

2. **Builds are unsigned.** No Apple Developer cert is configured, so
   `CSC_IDENTITY_AUTO_DISCOVERY=false` is set in CI. The DMG works but
   Gatekeeper would block it without the quarantine-strip step that
   `update-from-release.sh` performs. Real auto-update on macOS would
   require signing + notarization.

3. **Publish target is GitHub Releases only.** electron-builder's `publish`
   field in `electron-builder.yml` is not configured — CI uploads via
   `gh release create` directly. If you wire up auto-update, you'll want
   to set `publish: github` so the updater knows where to look.

4. **Per-Mac SQLite DB.** Each install has its own
   `~/Library/Application Support/sweet-creative-inventory/inventory.db`.
   No multi-device sync. Treat one Mac as canonical for live inventory or
   use the in-app Backup/Restore.

---

## Useful one-liners

```
gh run watch --repo Blake1280/MacApp-TSC          # follow CI in terminal
gh release list --repo Blake1280/MacApp-TSC       # see releases
gh release view --repo Blake1280/MacApp-TSC v0.3.5
git log --oneline -20
```

---

## Code-signing / notarization (when you decide to do it)

The full path to "push to git → other Mac auto-updates silently":
1. Apple Developer Program membership (~$99/yr).
2. Generate a Developer ID Application certificate, download as `.p12`.
3. Add `CSC_LINK` (base64 of .p12) and `CSC_KEY_PASSWORD` to GitHub Actions
   secrets; remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from the workflow.
4. Add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets;
   electron-builder will notarize automatically.
5. Fix the `electron-updater` `logger` TypeError in `src/main/`.
6. Add `publish: { provider: github }` to `electron-builder.yml`.
7. `bump-and-ship.sh` continues to work as the dev-side trigger; the
   receiving Mac no longer needs `update-from-release.sh` because the app
   updates itself on next launch.
