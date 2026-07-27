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

# Recover from a previous run that was killed.
#
# The swap below is protected by an EXIT trap, but a trap cannot run if the
# container is SIGKILLed — `docker kill`, Docker Desktop quitting, the OOM
# killer. When that happened the host was left with Linux binaries in
# `dashboard/node_modules` and its real modules stranded in
# `node_modules.host`, which then broke the host's own tooling: the next
# `git push` ran the pre-push leak scan over `node_modules.host` and failed on
# a base64 blob inside undici.
#
# So recovery happens on the way in, where it is guaranteed to run, rather than
# relying only on the way out.
if [ -d dashboard/node_modules.host ]; then
  echo "[linux] recovering from an interrupted previous run"
  rm -rf dashboard/node_modules
  mv dashboard/node_modules.host dashboard/node_modules
fi

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
# INT/TERM as well as EXIT: a plain `docker stop` sends SIGTERM, which is
# recoverable. Only SIGKILL is not, and that is what the check above covers.
trap restore EXIT INT TERM

echo "[linux] staging"
node desktop/scripts/stage-all.mjs

echo "[linux] verifying the staged bundle before building"
node desktop/scripts/verify-staging.mjs

echo "[linux] building"
cd desktop
cargo tauri build --config src-tauri/tauri.conf.json --bundles appimage,deb

echo "[linux] done"
