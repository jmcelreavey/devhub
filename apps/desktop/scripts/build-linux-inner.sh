#!/usr/bin/env bash
# Runs inside the Linux builder container. See build-linux.mjs.
set -euo pipefail

echo "[linux] node $(node --version), $(cargo --version)"

# build-linux.mjs mounts temporary dependency volumes over every workspace.
# Never run npm in the host-mounted checkout without those volumes.
if [ "${DEVHUB_LINUX_ISOLATED_MODULES:-}" != "1" ]; then
  echo "[linux] isolated dependency volumes are required; use build-linux.mjs" >&2
  exit 1
fi
export npm_config_cache=/tmp/npm-cache
DESKTOP_DIR="${DEVHUB_LINUX_DESKTOP_DIR:-/work/apps/desktop}"
cd /work
CI=1 DEVHUB_SKIP_POSTINSTALL=1 npm ci --include=dev --no-audit --no-fund

echo "[linux] staging"
node "$DESKTOP_DIR/scripts/stage-all.mjs"

echo "[linux] verifying the staged bundle before building"
node "$DESKTOP_DIR/scripts/verify-staging.mjs"

echo "[linux] building"
cd "$DESKTOP_DIR"
cargo tauri build --config src-tauri/tauri.conf.json --bundles appimage,deb --no-sign

echo "[linux] done"
