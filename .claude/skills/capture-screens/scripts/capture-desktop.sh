#!/usr/bin/env bash
# Builds the Codeo desktop app, launches it in demo mode on a throwaway data directory and saves
# PNG captures. Arguments after the script name are passed to capture-desktop.mjs:
#   capture-desktop.sh --out <dir> [--screens home,tasks] [--steps <module.mjs>] [--no-build]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
APP="$REPO/apps/desktop"
TOOLS="${CODEO_CAPTURE_TOOLS:-${TMPDIR:-/tmp}/codeo-capture-tools}"

BUILD=1
PASS=()
for a in "$@"; do
  if [[ "$a" == "--no-build" ]]; then BUILD=0; else PASS+=("$a"); fi
done

# 1. Dependencies and the Electron binary (pnpm does not run Electron's download script).
[[ -d "$REPO/node_modules" ]] || (cd "$REPO" && pnpm install --frozen-lockfile)
ELECTRON="$(cd "$APP" && node -p "require('path').dirname(require.resolve('electron/package.json'))")"
[[ -d "$ELECTRON/dist/Electron.app" ]] || (cd "$ELECTRON" && node install.js)

# 2. Build the runtime the app spawns, then the app itself.
if [[ "$BUILD" == 1 ]]; then
  LOG="$(mktemp "${TMPDIR:-/tmp}/codeo-capture-build.XXXXXX")"
  if ! (cd "$REPO" && pnpm --filter @codeo/runtime build && pnpm --filter @codeo/desktop build) >"$LOG" 2>&1; then
    tail -40 "$LOG" >&2; echo "build failed, full log: $LOG" >&2; exit 1
  fi
fi

# 3. playwright-core outside the repo (no change to package.json or the lockfile).
if [[ ! -d "$TOOLS/node_modules/playwright-core" ]]; then
  mkdir -p "$TOOLS"
  (cd "$TOOLS" && npm init -y >/dev/null && npm install --silent playwright-core@1.56.1)
fi
cp "$HERE/capture-desktop.mjs" "$TOOLS/"

# 4. Demo data in a fresh directory: never the user's ~/.codeo.
DATA="$(mktemp -d "${TMPDIR:-/tmp}/codeo-capture-data.XXXXXX")"
echo '{"demoMode":true}' > "$DATA/desktop-preferences.json"

# A neutral greeting name: the home screen otherwise shows the macOS user's first name.
CODEO_USER_NAME="${CODEO_USER_NAME:-Alex}" node "$TOOLS/capture-desktop.mjs" --app "$APP" --data "$DATA" "${PASS[@]}"
