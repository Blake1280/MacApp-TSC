# Installing Sweet Creative Inventory on a Mac

The Mac build comes out of the GitHub Actions workflow (`Build macOS`) on
every push to `main`. Tag a release (`git tag v0.4.0 && git push --tags`) and
the workflow attaches the installers to a GitHub Release automatically.

## Which file to grab

- **Apple Silicon (M1/M2/M3/M4)** — `Sweet Creative Inventory-<version>-arm64.dmg`
- **Intel Mac** — `Sweet Creative Inventory-<version>-x64.dmg`

Not sure which one? Apple menu → About This Mac. "Chip: Apple M…" means
arm64; "Processor: Intel…" means x64.

## First launch (one-time Gatekeeper step)

The app isn't signed with an Apple Developer certificate yet, so macOS warns
on first open. This is expected and only happens once:

1. Open the `.dmg` and drag **Sweet Creative Inventory** into **Applications**.
2. Try to open the app once — macOS will block it ("can't be opened" /
   "not from an identified developer"). Close the dialog.
3. Open **System Settings → Privacy & Security**, scroll down, and click
   **Open Anyway** next to the Sweet Creative Inventory message, then
   confirm.
   - On older macOS versions you can instead right-click the app in
     Applications and choose **Open → Open**.
4. From then on it opens normally from Launchpad / the Dock.

If macOS says the app is **"damaged and can't be opened"** (happens when the
download strips-and-flags the quarantine attribute), clear it in Terminal:

```sh
xattr -cr "/Applications/Sweet Creative Inventory.app"
```

## Where the data lives

The database is per-machine, at
`~/Library/Application Support/sweet-creative-inventory/inventory.db`.
Upgrading the app never touches it. Use **Settings → Backup** inside the app
to export a copy.

## Everyday Mac behaviour

- The app keeps running when the window is closed (standard macOS); click
  the Dock icon to reopen, **Cmd+Q** to quit fully.
- **Cmd+,** opens Settings, and all the usual Edit shortcuts
  (Cmd+C/V/X/A/Z) work everywhere.

## Getting a properly signed build later

To remove the Gatekeeper step entirely, enrol in the Apple Developer Program
(US$99/yr), then add `CSC_LINK` / `CSC_KEY_PASSWORD` secrets to the GitHub
repo and remove `CSC_IDENTITY_AUTO_DISCOVERY: false` from
`.github/workflows/build-mac.yml`. Notarisation can be added with
`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` env vars — electron-builder
handles the rest.
