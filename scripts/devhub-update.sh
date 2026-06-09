#!/usr/bin/env bash
# devhub-update.sh — pull DevHub core updates from the public `upstream` remote into
# your private mirror, then re-sync assets and validate.
#
# The public core has an UNRELATED history (it was seeded from a clean tree so private
# history never leaks), so this CANNOT rebase/merge onto upstream. Instead it ports the
# *content diff* of new upstream commits onto your mirror via `git apply --3way`, which
# also preserves your mirror-side customisation instead of clobbering it.
#
# To know "what's new", it tracks the last-pulled upstream commit in the git ref
# `refs/devhub/upstream-sync`. First run needs `--since <ref>` (the upstream commit your
# mirror was last in sync with — e.g. the initial public commit).
#
# Usage:
#   bash scripts/devhub-update.sh [--since <ref>] [--dry-run] [--no-sync]
#   bash scripts/devhub-update.sh --mark-synced     # record sync without applying
#
#   --since <ref>   Upstream commit to diff from (default: refs/devhub/upstream-sync).
#   --dry-run       Show incoming core changes, make no changes.
#   --no-sync       Apply only; skip the validate + asset sync afterward.
#   --mark-synced   Set the sync marker to upstream/HEAD and exit. Use after a backport,
#                   when your mirror already contains everything public has.
#
# See CONTRIBUTING.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SYNC_REF="refs/devhub/upstream-sync"
DRY_RUN=0
DO_SYNC=1
MARK_ONLY=0
SINCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-sync) DO_SYNC=0; shift ;;
    --mark-synced) MARK_ONLY=1; shift ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

log()  { echo "[devhub-update] $*"; }
fail() { echo "[devhub-update] ERROR: $*" >&2; exit 1; }

# Personal-data paths: excluded from the pull (never expected from upstream) AND ignored by
# the dirty-tree guard, so the app's live-dirty tasks/notes don't block a pull from the UI.
EXCLUDES=(':!notes' ':!tasks' ':!collections' ':!dashboard/.env.local'
          ':!persona/identity.txt' ':!TEMPLATE_AND_PLUGIN_PLAN.md' ':!scripts/make-public-seed.sh')

# --- guards ---
BRANCH="$(git branch --show-current)"
[[ "$BRANCH" == "main" || "$BRANCH" == "master" ]] \
  || fail "Not on main/master (current: $BRANCH). Switch first."
# Only non-personal tracked changes block a pull (they could collide with the 3-way apply).
[[ -z "$(git status --porcelain --untracked-files=no -- . "${EXCLUDES[@]}")" ]] \
  || fail "Non-personal tracked changes present. Commit or stash them, then re-run."
git remote get-url upstream >/dev/null 2>&1 || fail \
"No 'upstream' remote. Add the public core:
  git remote add upstream https://github.com/<owner>/devhub.git"

# --- fetch + resolve upstream default branch ---
log "Fetching upstream..."
git fetch --quiet upstream
UPSTREAM_BRANCH="$(git rev-parse --abbrev-ref upstream/HEAD 2>/dev/null | sed 's@^upstream/@@' || true)"
[[ -n "$UPSTREAM_BRANCH" ]] || UPSTREAM_BRANCH="$BRANCH"
UPSTREAM_REF="upstream/${UPSTREAM_BRANCH}"
UPSTREAM_SHA="$(git rev-parse "$UPSTREAM_REF")"

# --- mark-synced: record state, no apply (use after a backport) ---
if [[ "$MARK_ONLY" == "1" ]]; then
  git update-ref "$SYNC_REF" "$UPSTREAM_SHA"
  log "Marked synced at ${UPSTREAM_REF} ($(git rev-parse --short "$UPSTREAM_SHA")). No changes applied."
  exit 0
fi

# --- resolve the 'since' base ---
[[ -n "$SINCE" ]] || SINCE="$(git rev-parse --verify --quiet "$SYNC_REF" || true)"
[[ -n "$SINCE" ]] || fail \
"No sync marker yet. First run needs --since <ref> (the upstream commit your mirror was
last in sync with, e.g. the initial public commit: \`git log upstream/${UPSTREAM_BRANCH} --oneline\`).
After that, the marker (${SYNC_REF}) is tracked automatically."
git rev-parse --verify --quiet "$SINCE" >/dev/null || fail "Unknown --since ref: $SINCE"

# --- show incoming core changes ---
COUNT="$(git rev-list --count "${SINCE}..${UPSTREAM_REF}" 2>/dev/null || echo 0)"
if [[ "$COUNT" == "0" ]]; then
  log "Already up to date with ${UPSTREAM_REF}."
  git update-ref "$SYNC_REF" "$UPSTREAM_SHA"
  exit 0
fi
log "Incoming core commits ($COUNT) ${SINCE}..${UPSTREAM_REF}:"
git log --oneline "${SINCE}..${UPSTREAM_REF}" | sed 's/^/  /'

PATCH="$(git diff "${SINCE}..${UPSTREAM_REF}" -- . "${EXCLUDES[@]}")"
mapfile -t PATCH_FILES < <(git diff --name-only "${SINCE}..${UPSTREAM_REF}" -- . "${EXCLUDES[@]}")
if [[ -z "$PATCH" ]]; then
  log "No file changes after exclusions; marking synced."
  git update-ref "$SYNC_REF" "$UPSTREAM_SHA"
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "----- incoming diff (stat) -----"
  git diff --stat "${SINCE}..${UPSTREAM_REF}" -- . "${EXCLUDES[@]}"
  log "Dry run — no changes made."
  exit 0
fi

# --- apply onto the mirror (3-way preserves your customisation) ---
log "Applying ${SINCE}..${UPSTREAM_REF} onto ${BRANCH}..."
if ! printf '%s\n' "$PATCH" | git apply --index --3way 2>/tmp/devhub-update-apply.err; then
  cat /tmp/devhub-update-apply.err >&2 || true
  # Revert only files from the upstream patch — personal paths (tasks/notes/…) may stay
  # dirty on purpose and must not be wiped by a failed apply.
  for f in "${PATCH_FILES[@]}"; do
    [[ -n "$f" ]] || continue
    git reset --quiet HEAD -- "$f" 2>/dev/null || true
    git checkout --quiet HEAD -- "$f" 2>/dev/null || true
  done
  fail "Could not cleanly apply upstream changes (conflicts vs your mirror customisation).
Resolve manually: \`git diff ${SINCE}..${UPSTREAM_REF} -- . | git apply --3way\`, fix conflicts, commit."
fi

git commit --quiet -m "chore: pull core updates from ${UPSTREAM_REF} ($(git rev-parse --short "$SINCE")..$(git rev-parse --short "$UPSTREAM_SHA"))"
git update-ref "$SYNC_REF" "$UPSTREAM_SHA"
log "Applied and committed. Sync marker → $(git rev-parse --short "$UPSTREAM_SHA")."

# --- validate + sync ---
if [[ "$DO_SYNC" == "1" ]]; then
  log "Validating..."
  ( cd "$REPO_ROOT/dashboard" && npx tsx scripts/run-action.ts validate ) || fail "Validation failed."
  log "Syncing assets to local tools..."
  ( cd "$REPO_ROOT/dashboard" && npx tsx scripts/run-action.ts sync ) || fail "Sync failed."
fi

log "Done. You are now up to date with ${UPSTREAM_REF}."
