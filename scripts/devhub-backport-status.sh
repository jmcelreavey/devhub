#!/usr/bin/env bash
# devhub-backport-status.sh — what still needs backporting to public core?
#
# `devhub-backport.sh` ports a ref you name. Nothing told you *which* refs still
# need naming, so this mirror drifts ahead of core silently and each backport
# gets more conflict-prone the longer it waits. This closes that loop.
#
#   bash scripts/devhub-backport-status.sh                 # since the watermark
#   bash scripts/devhub-backport-status.sh --since <ref>    # since an explicit ref
#   bash scripts/devhub-backport-status.sh --set-watermark  # mark everything as done
#   bash scripts/devhub-backport-status.sh --quiet          # exit code only (hooks)
#
# Exit 0 = nothing pending. Exit 1 = commits are waiting. Never fails a push on
# its own; the pre-push hook treats a non-zero exit as a warning.
#
# Why a watermark rather than comparing histories: public core has an
# *unrelated* history (it was seeded from a clean tree so private history never
# leaks), and its commits are re-subjected as "Backport: <rewritten> (#N)". So
# there is no commit-level identity to diff against — matching by subject text
# would be guesswork. A watermark is honest about being a marker you move.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/public-paths.sh
source "$REPO_ROOT/scripts/lib/public-paths.sh"

WATERMARK_FILE=".git/devhub-backport-watermark"
SINCE=""
QUIET=0
SET_WATERMARK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="${2:-}"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    --set-watermark) SET_WATERMARK=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

log() { [[ "$QUIET" == "1" ]] || echo "$@"; }

if [[ "$SET_WATERMARK" == "1" ]]; then
  git rev-parse HEAD > "$WATERMARK_FILE"
  log "[backport-status] watermark set to $(git rev-parse --short HEAD) — nothing pending."
  exit 0
fi

if [[ -z "$SINCE" ]]; then
  if [[ -f "$WATERMARK_FILE" ]]; then
    SINCE="$(tr -d '[:space:]' < "$WATERMARK_FILE")"
  else
    # No watermark yet. Fall back to the newest commit that only touches
    # personal paths — everything after it is at least *plausibly* unported —
    # and tell the user to set a real one.
    # `-n 1` rather than piping to head: under `set -o pipefail`, head closing
    # the pipe SIGPIPEs git and takes the whole script down silently.
    SINCE="$(git log --format=%H -n 1 -- "${PERSONAL_PATHS[@]}")"
    log "[backport-status] No watermark yet (${WATERMARK_FILE#.git/})."
    log "[backport-status] Guessing from the last personal-only commit. Once you've"
    log "[backport-status] confirmed what core actually has, run --set-watermark."
    log ""
  fi
fi

if ! git rev-parse --verify --quiet "$SINCE" >/dev/null; then
  echo "[backport-status] Unknown ref: $SINCE" >&2
  exit 2
fi

# Commits after the watermark that touch anything in the public catalog.
# Read loop rather than `mapfile`: macOS ships bash 3.2, which doesn't have it,
# and every other script in this repo runs there.
PENDING=()
while IFS= read -r line; do
  [[ -n "$line" ]] && PENDING+=("$line")
done < <(git log --format='%h %s' "$SINCE..HEAD" -- "${PUBLIC_PATHS[@]}")

if [[ ${#PENDING[@]} -eq 0 ]]; then
  log "[backport-status] Up to date — no public-catalog commits since ${SINCE:0:8}."
  exit 0
fi

log "[backport-status] ${#PENDING[@]} commit(s) touch public paths and may need backporting:"
log ""
for line in "${PENDING[@]}"; do
  sha="${line%% *}"
  subject="${line#* }"
  files="$(git show --name-only --format= "$sha" -- "${PUBLIC_PATHS[@]}" | grep -c . || true)"
  files="${files:-0}"
  log "  $sha  $subject"
  log "            ${files} public file(s)"
done
log ""
log "  Port one:   bash scripts/devhub-backport.sh <ref>"
log "  Mark done:  bash scripts/devhub-backport-status.sh --set-watermark"

exit 1
