#!/usr/bin/env bash
# devhub-backport.sh — contribute a feature from your private mirror back to the public
# DevHub core as a clean PR. Branches off upstream/<default> and takes ONLY the feature
# files (personal data is excluded), scans for leaks, and previews by default.
#
# Usage:
#   bash scripts/devhub-backport.sh <source-ref> [--execute] [--title "PR title"]
#
#   <source-ref>   Branch/commit holding your feature (e.g. feat/plugin-system).
#   --execute      Actually commit, push to origin, and open the PR. Default: preview only.
#   --title "..."  PR title (default: derived from source-ref).
#
# Safety: branches off upstream so personal commits never ride along; drops personal-data
# paths; aborts on internal-name/secret hits. See CONTRIBUTING.md and TEMPLATE_AND_PLUGIN_PLAN.md (M4).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log()  { echo "[devhub-backport] $*"; }
fail() { echo "[devhub-backport] ERROR: $*" >&2; exit 1; }

SOURCE_REF=""
EXECUTE=0
TITLE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=1; shift ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    -*) fail "Unknown flag: $1" ;;
    *) SOURCE_REF="$1"; shift ;;
  esac
done
[[ -n "$SOURCE_REF" ]] || fail "Provide a source ref. Usage: devhub-backport.sh <source-ref> [--execute]"

# --- guards ---
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "Tracked changes present. Commit or stash, then re-run."
git rev-parse --verify --quiet "$SOURCE_REF" >/dev/null || fail "Unknown ref: $SOURCE_REF"
git remote get-url upstream >/dev/null 2>&1 || fail "No 'upstream' remote. Add the public core first."
if [[ "$EXECUTE" == "1" ]]; then command -v gh >/dev/null || fail "--execute needs the GitHub CLI (gh)."; fi

ORIG_BRANCH="$(git branch --show-current)"
restore() { git checkout --quiet "$ORIG_BRANCH" 2>/dev/null || true; }

log "Fetching upstream..."
git fetch --quiet upstream
UPSTREAM_BRANCH="$(git rev-parse --abbrev-ref upstream/HEAD 2>/dev/null | sed 's@^upstream/@@' || true)"
[[ -n "$UPSTREAM_BRANCH" ]] || UPSTREAM_BRANCH="main"
UPSTREAM_REF="upstream/${UPSTREAM_BRANCH}"
UPSTREAM_URL="$(git remote get-url upstream)"
UPSTREAM_SLUG="$(echo "$UPSTREAM_URL" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"

# --- personal-data exclusions ---
EXCLUDES=(':!notes' ':!tasks' ':!collections' ':!dashboard/.env.local'
          ':!persona/identity.txt' ':!TEMPLATE_AND_PLUGIN_PLAN.md')

# Personal paths that were touched but will be dropped (informational).
DROPPED="$(git diff --name-only "${UPSTREAM_REF}...${SOURCE_REF}" -- notes tasks collections \
            dashboard/.env.local persona/identity.txt TEMPLATE_AND_PLUGIN_PLAN.md 2>/dev/null || true)"
[[ -n "$DROPPED" ]] && { log "Dropping personal/strategy paths from the PR:"; echo "$DROPPED" | sed 's/^/  - /'; }

# Feature files to port (status + path), personal paths excluded.
# (read loop instead of mapfile for bash 3.2 / macOS compatibility)
CHANGES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && CHANGES+=("$line")
done < <(git diff --name-status "${UPSTREAM_REF}...${SOURCE_REF}" -- . "${EXCLUDES[@]}")
[[ ${#CHANGES[@]} -gt 0 ]] || fail "No feature files to backport after exclusions."

# --- build the backport branch off upstream ---
SAFE_NAME="$(echo "$SOURCE_REF" | tr '/ ' '--' | tr -cd 'A-Za-z0-9._-')"
BACKPORT_BRANCH="backport/${SAFE_NAME}"
log "Creating ${BACKPORT_BRANCH} off ${UPSTREAM_REF}..."
git branch -f "$BACKPORT_BRANCH" "$UPSTREAM_REF" >/dev/null
git checkout --quiet "$BACKPORT_BRANCH"
trap 'restore' EXIT

for line in "${CHANGES[@]}"; do
  status="${line%%$'\t'*}"; file="${line#*$'\t'}"
  if [[ "$status" == D* ]]; then
    git rm --quiet --ignore-unmatch -- "$file" || true
  else
    git checkout --quiet "$SOURCE_REF" -- "$file"
  fi
done

# --- leak scan on ADDED lines only (removing internal content must not trip it) ---
log "Scanning added lines for internal names / secrets..."
if ! git diff --cached -U0 | grep -E '^\+' | grep -vE '^\+\+\+' \
     | bash "$REPO_ROOT/scripts/scan-leaks.sh" stdin; then
  git reset --hard --quiet "$UPSTREAM_REF"
  fail "Leak scan hit denylisted terms. Clean the feature, then re-run."
fi

[[ -n "$TITLE" ]] || TITLE="Backport: ${SOURCE_REF}"
git commit --quiet -m "$TITLE"

echo "----- backport preview (${BACKPORT_BRANCH} vs ${UPSTREAM_REF}) -----"
git diff --stat "${UPSTREAM_REF}..${BACKPORT_BRANCH}"

if [[ "$EXECUTE" != "1" ]]; then
  log "Preview only. Committed on ${BACKPORT_BRANCH}. Re-run with --execute to push & PR."
  log "(Returning to ${ORIG_BRANCH}; the backport branch is kept for inspection.)"
  exit 0
fi

# --- execute: push, PR ---
log "Pushing ${BACKPORT_BRANCH} to origin..."
git push --quiet -u origin "$BACKPORT_BRANCH"
log "Opening PR against ${UPSTREAM_SLUG} (${UPSTREAM_BRANCH})..."
gh pr create --repo "$UPSTREAM_SLUG" --base "$UPSTREAM_BRANCH" --head "$BACKPORT_BRANCH" \
  --title "$TITLE" --body "Backported from \`${SOURCE_REF}\` via devhub-backport. Personal data excluded."
log "Done."
