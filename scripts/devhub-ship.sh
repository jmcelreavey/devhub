#!/usr/bin/env bash
# devhub-ship.sh — one-shot "push everything to main" for the DevHub mirror setup.
#
#   1. Commits personal data (notes/tasks/collections/upstarts) as its own commit on main.
#   2. Commits all remaining work as a feature commit (message = first arg).
#   3. Pushes origin main (private mirror; pre-push verify + leak scan run).
#   4. Ports the private-only content diff onto the public core via
#      devhub-backport.sh (leak scan gates), pushes upstream main DIRECTLY
#      (no PR), and advances the sync marker.
#   5. Commits & pushes every enabled plugin repo (~/.config/devhub/plugins.json)
#      to its current branch.
#
# Usage:
#   bash scripts/devhub-ship.sh ["feature commit message"] [--dry-run] [--no-upstream]
#
# Notes: personal paths (notes/, tasks/, …) never reach the public core — the
# backport step drops them and the leak scan blocks internal names/secrets.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log()  { echo "[devhub-ship] $*"; }
fail() { echo "[devhub-ship] SHIP FAILED: $*" >&2; exit 1; }
trap '[[ $? -ne 0 ]] && echo "[devhub-ship] SHIP FAILED (see above)" >&2' EXIT

MSG="chore: ship local work"
DRY=0
NO_UPSTREAM=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-upstream) NO_UPSTREAM=1 ;;
    -*) fail "Unknown flag: $arg" ;;
    *) MSG="$arg" ;;
  esac
done

BRANCH="$(git branch --show-current)"
[[ "$BRANCH" == "main" || "$BRANCH" == "master" ]] || fail "Run from main/master (on '$BRANCH')."

UPSTREAM_BRANCH=""
UPSTREAM_REF=""
UPSTREAM_SHA=""
prepare_upstream() {
  git remote get-url upstream >/dev/null 2>&1 || fail "No 'upstream' remote. Add the public core or use --no-upstream."
  git fetch --quiet upstream
  UPSTREAM_BRANCH="$(git rev-parse --abbrev-ref upstream/HEAD 2>/dev/null | sed 's@^upstream/@@' || true)"
  [[ -n "$UPSTREAM_BRANCH" ]] || UPSTREAM_BRANCH="main"
  UPSTREAM_REF="upstream/${UPSTREAM_BRANCH}"
  UPSTREAM_SHA="$(git rev-parse "$UPSTREAM_REF")"
}

upstream_is_synced() {
  [[ "$(git rev-parse --verify --quiet refs/devhub/upstream-sync || true)" == "$UPSTREAM_SHA" ]]
}

preview_public_patch() {
  local source_ref="$1"
  bash scripts/devhub-backport.sh "$source_ref" --base "$UPSTREAM_REF" --patch-only --require-synced
}

if [[ "$NO_UPSTREAM" == "0" ]]; then
  prepare_upstream
fi

if [[ "$DRY" == "1" ]]; then
  log "DRY RUN — would commit:"
  git status --porcelain | awk 'NR <= 50 { print "  " $0 }'
  total="$(git status --porcelain | wc -l | tr -d ' ')"
  log "($total changed path(s))"
  if [[ "$NO_UPSTREAM" == "0" ]]; then
    upstream_is_synced || fail "Public core has newer changes. Run scripts/devhub-update.sh before previewing the outbound patch."
    PREVIEW_INDEX="$(mktemp "${TMPDIR:-/tmp}/devhub-ship-index.XXXXXX")"
    rm -f "$PREVIEW_INDEX"
    trap 'status=$?; rm -f "${PREVIEW_INDEX:-}"; [[ $status -ne 0 ]] && echo "[devhub-ship] SHIP FAILED (see above)" >&2; exit $status' EXIT
    # Preserve skip-worktree bits so materialised plugin overlays are not mistaken for
    # public changes. Starting from HEAD would drop those bits and leak local overlays.
    cp "$(git rev-parse --git-path index)" "$PREVIEW_INDEX"
    GIT_INDEX_FILE="$PREVIEW_INDEX" git add -A
    PREVIEW_TREE="$(GIT_INDEX_FILE="$PREVIEW_INDEX" git write-tree)"
    log "Actual public patch, including committed and uncommitted divergence:"
    if preview_public_patch "$PREVIEW_TREE"; then
      :
    else
      status=$?
      [[ "$status" == "3" ]] || exit "$status"
    fi
  fi
  log "Dry run complete; nothing was committed or pushed."
  exit 0
fi

# 1. Personal data commit (private only; backport drops these paths anyway).
git add notes tasks collections upstarts 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit --quiet -m "chore: sync personal data"
  log "Committed personal data (notes/tasks/collections/upstarts)."
fi

# 2. Everything else.
git add -A
if ! git diff --cached --quiet; then
  git commit --quiet -m "$MSG"
  log "Committed: $MSG"
fi

# Import public changes before deriving an outbound patch. Applying after the public
# patch is computed is how reconciliation turns into accidental overwrites. Fun stuff.
if [[ "$NO_UPSTREAM" == "0" ]] && ! upstream_is_synced; then
  log "Public core is newer; importing it before shipping..."
  bash scripts/devhub-update.sh
  prepare_upstream
  upstream_is_synced || fail "Public core changed during reconciliation. Re-run ship."
fi

# 3. Private mirror.
if [[ -n "$(git rev-list @{u}..HEAD 2>/dev/null || echo x)" ]]; then
  log "Pushing origin $BRANCH (pre-push verify runs — this takes a few minutes)..."
  git push origin "$BRANCH"
fi

# 4. Public core — straight to main, no PR. The backport script handles the
# skip-worktree overlay dance, excludes personal paths, and leak-scans added lines.
if [[ "$NO_UPSTREAM" == "0" ]]; then
  PUBLIC_PATCH=1
  if preview_public_patch "$BRANCH"; then
    :
  else
    status=$?
    if [[ "$status" == "3" ]]; then
      PUBLIC_PATCH=0
    else
      exit "$status"
    fi
  fi
  if [[ "$PUBLIC_PATCH" == "0" ]]; then
    log "Public core already has everything — skipping upstream push."
  else
    log "Porting content diff onto upstream/${UPSTREAM_BRANCH}..."
    bash scripts/devhub-backport.sh "$BRANCH" --base "$UPSTREAM_REF" --require-synced --title "$MSG"
    log "Pushing upstream ${UPSTREAM_BRANCH} directly (no PR)..."
    git push upstream "backport/${BRANCH}:${UPSTREAM_BRANCH}"
    bash scripts/devhub-update.sh --mark-synced
  fi
fi

# 5. Plugin repos.
PLUGIN_PATHS="$(python3 - <<'EOF'
import json, os
p = os.path.expanduser('~/.config/devhub/plugins.json')
try:
    d = json.load(open(p))
except Exception:
    d = {}
for entry in d.get('plugins', []):
    if entry.get('enabled', True):
        print(os.path.expanduser(entry['path']))
EOF
)"
for plugin_path in $PLUGIN_PATHS; do
  [[ -d "$plugin_path/.git" ]] || continue
  name="$(basename "$plugin_path")"
  (
    cd "$plugin_path"
    pbranch="$(git branch --show-current)"
    git add -A
    if ! git diff --cached --quiet; then
      git commit --quiet -m "$MSG"
      log "[$name] committed: $MSG"
    fi
    if [[ -n "$(git rev-list "origin/${pbranch}..HEAD" 2>/dev/null)" ]]; then
      log "[$name] pushing origin $pbranch..."
      git push origin "$pbranch"
    else
      log "[$name] up to date."
    fi
  )
done

log "SHIP DONE"
