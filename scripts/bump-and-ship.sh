#!/usr/bin/env bash
#
# bump-and-ship.sh — bump the version, tag, push, and trigger CI to
# build + publish a new GitHub Release with macOS DMGs attached.
#
# Usage:
#   ./scripts/bump-and-ship.sh             # patch bump (0.3.5 -> 0.3.6)
#   ./scripts/bump-and-ship.sh minor       # 0.3.5 -> 0.4.0
#   ./scripts/bump-and-ship.sh major       # 0.3.5 -> 1.0.0
#   ./scripts/bump-and-ship.sh 0.4.2       # explicit version
#
# What it does:
#   1. Verifies the working tree is clean (no uncommitted changes)
#   2. Verifies you're on main and up-to-date with origin
#   3. Runs `npm version <bump>` which:
#        - updates package.json
#        - creates a commit "v0.X.Y"
#        - creates a git tag "v0.X.Y"
#   4. Pushes the commit and the tag
#   5. The CI workflow (.github/workflows/build-mac.yml) sees the tag push
#      and publishes a GitHub Release with the DMGs
#
# After this finishes, the other Mac just runs:
#   ./scripts/update-from-release.sh
# to pull the new build.

set -euo pipefail

BUMP="${1:-patch}"

# Sanity checks
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree not clean. Commit or stash first." >&2
  git status --short
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: you are on '$CURRENT_BRANCH', not 'main'. Switch first." >&2
  exit 1
fi

echo "==> Fetching origin"
git fetch origin --quiet

LOCAL="$(git rev-parse main)"
REMOTE="$(git rev-parse origin/main)"
if [[ "$LOCAL" != "$REMOTE" ]]; then
  echo "ERROR: local main and origin/main have diverged. Pull/rebase first." >&2
  exit 1
fi

echo "==> Bumping version ($BUMP)"
NEW_VERSION="$(npm version "$BUMP" -m 'release: %s')"
echo "==> New version: $NEW_VERSION"

echo "==> Pushing commit + tag"
git push origin main
git push origin "$NEW_VERSION"

echo
echo "Done. CI is now building $NEW_VERSION."
echo "Watch progress:    gh run watch --repo Blake1280/MacApp-TSC"
echo "When CI finishes,  on the other Mac run:  ./scripts/update-from-release.sh"
