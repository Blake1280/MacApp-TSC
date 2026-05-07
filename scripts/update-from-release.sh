#!/usr/bin/env bash
#
# update-from-release.sh — install the latest published release of
# Sweet Creative Inventory onto this Mac.
#
# Usage:
#   ./scripts/update-from-release.sh           # latest release
#   ./scripts/update-from-release.sh v0.3.6    # specific tag
#
# Prerequisites (one-time per Mac):
#   brew install gh
#   gh auth login          # follow browser flow
#
# What it does:
#   1. Downloads the *-arm64.dmg (Apple Silicon) from the chosen GitHub Release
#   2. Mounts it, copies the .app over the existing one in /Applications
#   3. Removes the macOS quarantine flag (the app is unsigned, so without
#      this Gatekeeper would block launch with "damaged" / "cannot be verified")
#   4. Unmounts and cleans up
#
# Safe to run repeatedly. Replaces only the .app bundle. Your local data
# at ~/Library/Application Support/sweet-creative-inventory/ is untouched.

set -euo pipefail

REPO="Blake1280/MacApp-TSC"
APP_NAME="Sweet Creative Inventory.app"
INSTALL_DIR="/Applications"
TAG="${1:-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: 'gh' (GitHub CLI) not installed. Run: brew install gh && gh auth login" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: 'gh' not authenticated. Run: gh auth login" >&2
  exit 1
fi

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  PATTERN='*arm64.dmg'
else
  PATTERN='*x64.dmg'
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

echo "==> Downloading latest $PATTERN from $REPO${TAG:+ (tag $TAG)}"
if [[ -n "$TAG" ]]; then
  gh release download "$TAG" --repo "$REPO" --pattern "$PATTERN" --clobber
else
  gh release download --repo "$REPO" --pattern "$PATTERN" --clobber
fi

DMG="$(ls *.dmg | head -1)"
if [[ -z "$DMG" ]]; then
  echo "ERROR: no DMG matched '$PATTERN' in the release" >&2
  exit 1
fi
echo "==> Got: $DMG"

echo "==> Mounting"
MOUNT="$(hdiutil attach -nobrowse -noverify -noautoopen "$DMG" | tail -1 | awk '{print $3}')"
if [[ -z "$MOUNT" || ! -d "$MOUNT" ]]; then
  echo "ERROR: failed to mount $DMG" >&2
  exit 1
fi

echo "==> Replacing $INSTALL_DIR/$APP_NAME"
rm -rf "$INSTALL_DIR/$APP_NAME"
cp -R "$MOUNT/$APP_NAME" "$INSTALL_DIR/"

echo "==> Unmounting"
hdiutil detach "$MOUNT" -quiet

echo "==> Removing quarantine flag (app is unsigned)"
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

echo
echo "Done. Launch from Applications or:"
echo "  open \"$INSTALL_DIR/$APP_NAME\""
