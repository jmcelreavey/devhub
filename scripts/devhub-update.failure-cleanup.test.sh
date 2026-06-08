#!/usr/bin/env bash
# Regression: failed apply must not discard live edits in personal paths (tasks/, notes/, …).
# Those paths are excluded from the dirty-tree guard so pulls can run from the dashboard
# while the user has uncommitted task/note changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

setup_repo() {
  local dir="$1"
  git -C "$dir" init -q
  git -C "$dir" config user.email "devhub-test@example.com"
  git -C "$dir" config user.name "devhub-test"
  git -C "$dir" branch -M main
}

log() { echo "[devhub-update.failure-cleanup.test] $*"; }

UPSTREAM="$TMP/upstream"
MIRROR="$TMP/mirror"
mkdir -p "$UPSTREAM" "$MIRROR"

setup_repo "$UPSTREAM"
echo "core v1" >"$UPSTREAM/core.txt"
git -C "$UPSTREAM" add core.txt
git -C "$UPSTREAM" commit -q -m "upstream base"
UP_BASE="$(git -C "$UPSTREAM" rev-parse HEAD)"
echo "core v2 upstream" >"$UPSTREAM/core.txt"
git -C "$UPSTREAM" add core.txt
git -C "$UPSTREAM" commit -q -m "upstream update"

setup_repo "$MIRROR"
echo "core v1 mirror-custom" >"$MIRROR/core.txt"
mkdir -p "$MIRROR/tasks"
echo '[]' >"$MIRROR/tasks/live.json"
git -C "$MIRROR" add .
git -C "$MIRROR" commit -q -m "mirror base"
git -C "$MIRROR" remote add upstream "$UPSTREAM"
git -C "$MIRROR" fetch -q upstream
git -C "$MIRROR" update-ref refs/devhub/upstream-sync "$UP_BASE"

# Live personal edit — allowed by the dirty-tree guard, must survive apply failure.
echo '[{"id":"live-edit","title":"keep me"}]' >"$MIRROR/tasks/live.json"

log "Running devhub-update (expect apply failure)..."
set +e
OUT="$(cd "$MIRROR" && bash "$ROOT/scripts/devhub-update.sh" --no-sync 2>&1)"
CODE=$?
set -e

if [[ "$CODE" == "0" ]]; then
  echo "$OUT"
  log "ERROR: expected non-zero exit when apply conflicts"
  exit 1
fi

if ! grep -q 'keep me' "$MIRROR/tasks/live.json"; then
  echo "$OUT"
  log "ERROR: personal tasks edit was wiped after failed apply"
  cat "$MIRROR/tasks/live.json" || true
  exit 1
fi

log "OK — personal-path edits preserved after apply failure"
