#!/usr/bin/env bash
# devhub-update.sh — pull DevHub core updates from the public `upstream` remote into
# your private mirror, then re-sync assets and validate.
#
# Usage:
#   bash scripts/devhub-update.sh [--dry-run] [--no-sync]
#
#   --dry-run   Show incoming core changes, make no changes.
#   --no-sync   Rebase only; skip the validate + asset sync afterward.
#
# See TEMPLATE_AND_PLUGIN_PLAN.md (M4) and CONTRIBUTING.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
DO_SYNC=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-sync) DO_SYNC=0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { echo "[devhub-update] $*"; }
fail() { echo "[devhub-update] ERROR: $*" >&2; exit 1; }

# --- guards ---
BRANCH="$(git branch --show-current)"
[[ "$BRANCH" == "main" || "$BRANCH" == "master" ]] \
  || fail "Not on main/master (current: $BRANCH). Switch first."

[[ -z "$(git status --porcelain --untracked-files=no)" ]] \
  || fail "Tracked changes present. Commit or stash, then re-run."

git remote get-url upstream >/dev/null 2>&1 || fail \
"No 'upstream' remote. Add the public core:
  git remote add upstream https://github.com/<owner>/devhub.git"

# --- fetch + resolve upstream default branch ---
log "Fetching upstream..."
git fetch --quiet upstream
UPSTREAM_BRANCH="$(git rev-parse --abbrev-ref upstream/HEAD 2>/dev/null | sed 's@^upstream/@@' || true)"
[[ -n "$UPSTREAM_BRANCH" ]] || UPSTREAM_BRANCH="$BRANCH"
UPSTREAM_REF="upstream/${UPSTREAM_BRANCH}"

# --- show incoming core changes (ignore personal dirs) ---
RANGE="HEAD..${UPSTREAM_REF}"
COUNT="$(git rev-list --count "$RANGE" 2>/dev/null || echo 0)"
if [[ "$COUNT" == "0" ]]; then
  log "Already up to date with ${UPSTREAM_REF}."
  exit 0
fi
log "Incoming core commits ($COUNT) from ${UPSTREAM_REF}:"
git log --oneline "$RANGE" -- dashboard/ persona/ skills/ agents/ scripts/ docs/ \
  mcp/ mcp-servers/ ':!notes' ':!tasks' ':!collections' | sed 's/^/  /'

if [[ "$DRY_RUN" == "1" ]]; then
  log "Dry run — no changes made."
  exit 0
fi

# --- rebase ---
log "Rebasing onto ${UPSTREAM_REF}..."
if ! git rebase "$UPSTREAM_REF"; then
  fail "Rebase hit conflicts. Resolve them, then 'git rebase --continue' (or 'git rebase --abort')."
fi
log "Rebase complete."

# --- validate + sync ---
if [[ "$DO_SYNC" == "1" ]]; then
  log "Validating..."
  ( cd "$REPO_ROOT/dashboard" && npx tsx scripts/run-action.ts validate ) || fail "Validation failed."
  log "Syncing assets to local tools..."
  ( cd "$REPO_ROOT/dashboard" && npx tsx scripts/run-action.ts sync ) || fail "Sync failed."
fi

log "Done. You are now up to date with ${UPSTREAM_REF}."
