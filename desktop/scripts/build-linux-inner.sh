#!/usr/bin/env bash
# Runs inside the Linux builder container. See build-linux.mjs.
set -euo pipefail

echo "[linux] node $(node --version), $(cargo --version)"

# The dashboard's node_modules are macOS-built — native modules (node-pty,
# esbuild) are platform-specific binaries and will not load here. A separate
# install directory keeps the host's working tree intact while giving the
# container the Linux binaries it needs.
export npm_config_cache=/tmp/npm-cache

if [ ! -d /tmp/linux-modules/node_modules ]; then
  echo "[linux] installing Linux-native dashboard dependencies (first run only)"
  mkdir -p /tmp/linux-modules
  cp /work/dashboard/package.json /tmp/linux-modules/
  [ -f /work/dashboard/package-lock.json ] && cp /work/dashboard/package-lock.json /tmp/linux-modules/
  cd /tmp/linux-modules
  # --ignore-scripts skips the repo's postinstall, which expects a full
  # checkout layout; we only need the packages themselves.
  npm install --no-audit --no-fund --ignore-scripts
fi

cd /work

# Swap in the Linux modules for the duration of the build, then put the
# macOS ones back. The host tree must be exactly as we found it.
MOVED=0
if [ -d dashboard/node_modules ]; then
  mv dashboard/node_modules dashboard/node_modules.host
  MOVED=1
fi
cp -a /tmp/linux-modules/node_modules dashboard/node_modules

restore() {
  rm -rf dashboard/node_modules
  if [ "$MOVED" = "1" ]; then
    mv dashboard/node_modules.host dashboard/node_modules
  fi
}
trap restore EXIT

echo "[linux] staging"
node desktop/scripts/stage-all.mjs

echo "[linux] verifying the staged bundle before building"
node desktop/scripts/verify-staging.mjs

echo "[linux] building"
cd desktop
cargo tauri build --config src-tauri/tauri.conf.json --bundles appimage,deb

echo "[linux] done"
