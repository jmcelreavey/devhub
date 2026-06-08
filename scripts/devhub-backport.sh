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
# The public core has an UNRELATED history (it was seeded from a clean tree so private
# history never leaks), so this ports the feature's *hunks* onto upstream via `git apply`
# rather than rebasing/cherry-picking. That also preserves any public-side templatisation
# (e.g. example-org) instead of clobbering whole files with the mirror's version.
#
# Safety: builds off upstream so personal commits never ride along; drops personal-data
# paths; aborts on internal-name/secret hits. See CONTRIBUTING.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log()  { echo "[devhub-backport] $*"; }
fail() { echo "[devhub-backport] ERROR: $*" >&2; exit 1; }

SOURCE_REF=""
BASE_REF=""
EXECUTE=0
TITLE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=1; shift ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --base) BASE_REF="${2:-}"; shift 2 ;;
    -*) fail "Unknown flag: $1" ;;
    *) SOURCE_REF="$1"; shift ;;
  esac
done
[[ -n "$SOURCE_REF" ]] || fail "Provide a source ref. Usage: devhub-backport.sh <source-ref> [--base <ref>] [--execute]"
# Base = the mirror commit already represented in public core. Defaults to the source's
# parent (correct when backporting the tip commit after a fresh pull). For a multi-commit
# feature, pass --base <branch-point>.
[[ -n "$BASE_REF" ]] || BASE_REF="${SOURCE_REF}^"

# --- guards ---
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "Tracked changes present. Commit or stash, then re-run."
git rev-parse --verify --quiet "$SOURCE_REF" >/dev/null || fail "Unknown ref: $SOURCE_REF"
git rev-parse --verify --quiet "$BASE_REF" >/dev/null || fail "Unknown base ref: $BASE_REF"
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

# --- personal-data exclusions (these never go to the public core) ---
EXCLUDES=(':!notes' ':!tasks' ':!collections' ':!dashboard/.env.local'
          ':!persona/identity.txt' ':!TEMPLATE_AND_PLUGIN_PLAN.md' ':!scripts/make-public-seed.sh')

# Personal paths that were touched but will be dropped (informational).
DROPPED="$(git diff --name-only "${BASE_REF}..${SOURCE_REF}" -- notes tasks collections \
            dashboard/.env.local persona/identity.txt TEMPLATE_AND_PLUGIN_PLAN.md \
            scripts/make-public-seed.sh 2>/dev/null || true)"
[[ -n "$DROPPED" ]] && { log "Dropping personal/strategy paths from the PR:"; echo "$DROPPED" | sed 's/^/  - /'; }

# The feature's patch (hunks only), personal paths excluded.
PATCH="$(git diff "${BASE_REF}..${SOURCE_REF}" -- . "${EXCLUDES[@]}")"
[[ -n "$PATCH" ]] || fail "No feature changes to backport after exclusions (check --base)."

log "Porting ${BASE_REF}..${SOURCE_REF} onto ${UPSTREAM_REF}"

# --- build the backport branch off upstream ---
SAFE_NAME="$(echo "$SOURCE_REF" | tr '/ ' '--' | tr -cd 'A-Za-z0-9._-')"
BACKPORT_BRANCH="backport/${SAFE_NAME}"
log "Creating ${BACKPORT_BRANCH} off ${UPSTREAM_REF}..."
git branch -f "$BACKPORT_BRANCH" "$UPSTREAM_REF" >/dev/null
git checkout --quiet "$BACKPORT_BRANCH"
trap 'restore' EXIT

# Apply hunks onto upstream (3-way so public-side templatisation survives). On conflict,
# git apply aborts non-zero and stages nothing.
if ! printf '%s\n' "$PATCH" | git apply --index --3way 2>/tmp/devhub-backport-apply.err; then
  cat /tmp/devhub-backport-apply.err >&2 || true
  git reset --hard --quiet "$UPSTREAM_REF"
  fail "Could not cleanly apply the feature onto upstream. Resolve divergence and retry (maybe --base is wrong, or core changed the same lines)."
fi

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

# --- execute: push to the PUBLIC core + open PR there ---
# origin is the private mirror (unrelated history), so the PR head must live in upstream.
log "Pushing ${BACKPORT_BRANCH} to upstream (${UPSTREAM_SLUG})..."
git push --quiet -u upstream "$BACKPORT_BRANCH"
log "Opening PR against ${UPSTREAM_SLUG} (${UPSTREAM_BRANCH})..."
gh pr create --repo "$UPSTREAM_SLUG" --base "$UPSTREAM_BRANCH" --head "$BACKPORT_BRANCH" \
  --title "$TITLE" --body "Backported from \`${SOURCE_REF}\` via devhub-backport. Personal data excluded."
log "Done."
