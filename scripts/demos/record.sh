#!/usr/bin/env bash
#
# Record the README demo (docs/assets/demos/control-layer.gif) against a disposable fixture.
#
# Why a fixture: the demo runs a real sync, which writes into $HOME, and real MCP
# calls, which write notes. Pointed at a real machine it would both record and
# overwrite real tool configs and notes. So this builds a throwaway checkout (committed
# shared content only — no notes, tasks, collections or identity) plus a throwaway
# HOME, and the tape refuses to do anything without them.
#
# Usage:  npm run demos:record
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="${DEVHUB_DEMO_FIXTURE:-/tmp/devhub-demo-fixture}"
MARKER="$FIXTURE/.devhub-demo-fixture"
OUT="$REPO_ROOT/docs/assets/demos/control-layer.gif"

if ! command -v vhs >/dev/null 2>&1; then
  echo "vhs is not installed. brew install vhs" >&2
  exit 1
fi

for dep in dashboard/node_modules mcp-servers/devhub-server/node_modules; do
  if [ ! -d "$REPO_ROOT/$dep" ]; then
    echo "$dep is missing — run npm install first" >&2
    exit 1
  fi
done

# DEVHUB_DEMO_FIXTURE is user-overridable, so never rm -rf a directory we did not create.
if [ -e "$FIXTURE" ] && [ ! -e "$MARKER" ]; then
  echo "$FIXTURE exists and is not a demo fixture — refusing to delete it" >&2
  exit 1
fi

echo "Building fixture at $FIXTURE"
rm -rf "$FIXTURE"
mkdir -p "$FIXTURE/home" "$FIXTURE/notes" "$FIXTURE/docs" "$FIXTURE/devhub"
touch "$MARKER"
git -C "$REPO_ROOT" archive HEAD -- . ':!notes' ':!tasks' ':!collections' ':!persona/identity.txt' |
  tar -x -C "$FIXTURE/devhub"
# Sync only runs against a git checkout.
git -C "$FIXTURE/devhub" init -q
ln -s "$REPO_ROOT/dashboard/node_modules" "$FIXTURE/devhub/dashboard/node_modules"
ln -s "$REPO_ROOT/mcp-servers/devhub-server/node_modules" "$FIXTURE/devhub/mcp-servers/devhub-server/node_modules"

# The tape hides stderr to keep absolute paths off screen, so a missing file would
# record a silent, empty scene. The fixture comes from HEAD: uncommitted files are absent.
for required in dashboard/scripts/run-action.ts mcp-servers/devhub-server/scripts/call-tool.mjs persona/shared-persona.md; do
  if [ ! -e "$FIXTURE/devhub/$required" ]; then
    echo "fixture is missing $required — commit it first (the fixture is built from HEAD)" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# cd into the tape directory: VHS resolves a relative Output against the caller's cwd.
(
  cd "$REPO_ROOT/scripts/demos"
  DEVHUB_DEMO_FIXTURE="$FIXTURE" vhs control-layer.tape
)

# vhs exits 0 even when ffmpeg could not write the file, so check the artefact.
if [ ! -s "$OUT" ]; then
  echo "recording produced no GIF at $OUT" >&2
  exit 1
fi

echo
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "Review every frame before publishing."
