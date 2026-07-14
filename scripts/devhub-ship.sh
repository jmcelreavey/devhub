#!/usr/bin/env bash
# devhub-ship.sh — one-shot "push everything to main" for the DevHub mirror setup.
#
#   1. Commits personal data (notes/tasks/collections) as its own commit on main.
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

if [[ "$DRY" == "1" ]]; then
  log "DRY RUN — would commit:"
  git status --porcelain | sed 's/^/  /' | head -50
  total="$(git status --porcelain | wc -l | tr -d ' ')"
  log "($total changed path(s); nothing was committed or pushed)"
  exit 0
fi

# 1. Personal data commit (private only; backport drops these paths anyway).
git add notes tasks collections 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit --quiet -m "chore: sync notes and tasks"
  log "Committed personal data (notes/tasks/collections)."
fi

# 2. Everything else.
git add -A
if ! git diff --cached --quiet; then
  git commit --quiet -m "$MSG"
  log "Committed: $MSG"
fi

# 3. Private mirror.
if [[ -n "$(git rev-list @{u}..HEAD 2>/dev/null || echo x)" ]]; then
  log "Pushing origin $BRANCH (pre-push verify runs — this takes a few minutes)..."
  git push origin "$BRANCH"
fi

# 4. Public core — straight to main, no PR. The backport script handles the
# skip-worktree overlay dance, excludes personal paths, and leak-scans added lines.
if [[ "$NO_UPSTREAM" == "0" ]] && git remote get-url upstream >/dev/null 2>&1; then
  git fetch --quiet upstream
  UPSTREAM_BRANCH="$(git rev-parse --abbrev-ref upstream/HEAD 2>/dev/null | sed 's@^upstream/@@' || true)"
  [[ -n "$UPSTREAM_BRANCH" ]] || UPSTREAM_BRANCH="main"
  if [[ -z "$(git diff "upstream/${UPSTREAM_BRANCH}..HEAD" -- . ':!notes' ':!tasks' ':!collections' ':!dashboard/.env.local' ':!persona/identity.txt' ':!TEMPLATE_AND_PLUGIN_PLAN.md' ':!scripts/make-public-seed.sh')" ]]; then
    log "Public core already has everything — skipping upstream push."
  else
    log "Porting content diff onto upstream/${UPSTREAM_BRANCH}..."
    bash scripts/devhub-backport.sh "$BRANCH" --base "upstream/${UPSTREAM_BRANCH}" --title "$MSG"
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
