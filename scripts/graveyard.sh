#!/usr/bin/env bash
#
# Run project-graveyard with every git identity you actually commit under.
#
# ## Why this wrapper exists
#
# A plain run over ~/Developer reports "not yours (skipped): 10" and finds
# nothing, which reads like a broken tool. There are two separate causes, and
# it is worth being precise because only one of them is fixable here.
#
# **Multiple identities — this script fixes it.** `graveyard.py` matches commit
# emails against your git identity. Anyone committing under both a personal and
# a work address has half their history disowned. The skill documents `--me`,
# but documentation is the wrong fix: it must be remembered on every
# invocation, by an agent with no way to know which addresses you use, and it
# goes stale the day you add another. So this derives them — global identity
# plus the per-repo `user.email` of every repo under the scan roots, deduped
# and passed as `--me`. A new work identity fixes itself.
#
# **Authorship share — this script deliberately does not fix it.** Even with
# every identity claimed, shared work repos still skip: the scanner also drops
# repos where you wrote under ~20% of commits, on the reasoning that a checkout
# you contribute to is not a side project you abandoned. On this machine `capi`
# is 256 of 1428 commits — 18%, just under the line.
#
# That default is right for the question the skill asks. A repo forty
# colleagues commit to is not your corpse, and overriding it globally would
# bury the signal under work checkouts. Pass `--include-foreign` when you
# genuinely want them; note they mostly come back classified as *finished*
# rather than dead, which is the honest answer for a shipped, stable service.
#
# ## Usage
#
#   scripts/graveyard.sh                     # scan REPO_ROOT (or ~/Developer)
#   scripts/graveyard.sh ~/code ~/projects   # explicit roots
#   scripts/graveyard.sh --days 90 --redact  # flags pass through
#   scripts/graveyard.sh --include-foreign   # include shared work checkouts
#
set -euo pipefail

REPO_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL="$REPO_ROOT_DIR/skills/vendor/project-graveyard/scripts/graveyard.py"

if [ ! -f "$SKILL" ]; then
  echo "project-graveyard is not vendored at $SKILL" >&2
  exit 1
fi

# Split leading directory arguments from flags, so both forms work:
#   graveyard.sh ~/code --days 90
#   graveyard.sh --days 90
roots=()
while [ $# -gt 0 ] && [[ "$1" != -* ]]; do
  roots+=("$1")
  shift
done

if [ ${#roots[@]} -eq 0 ]; then
  # DevHub already knows where the user's code lives; reuse it rather than
  # inventing a second notion of "your projects directory".
  roots=("${REPO_ROOT:-$HOME/Developer}")
fi

collect_identities() {
  # Global identity first — the one most commits use.
  git config --global user.email 2>/dev/null || true

  # Then any repo that overrides it. `-maxdepth 3` because a projects directory
  # is a shallow forest; recursing further finds vendored checkouts inside
  # node_modules and slows the scan for no benefit.
  for root in "${roots[@]}"; do
    [ -d "$root" ] || continue
    while IFS= read -r gitdir; do
      repo="$(dirname "$gitdir")"
      git -C "$repo" config --local user.email 2>/dev/null || true
    done < <(find "$root" -maxdepth 3 -name .git -maxdepth 3 -print 2>/dev/null)
  done
}

me_flags=()
while IFS= read -r email; do
  [ -n "$email" ] || continue
  me_flags+=(--me "$email")
done < <(collect_identities | sort -u)

if [ ${#me_flags[@]} -eq 0 ]; then
  echo "warning: found no git identities; every repo will be skipped as 'not yours'." >&2
  echo "         set one with: git config --global user.email you@example.com" >&2
else
  echo "claiming commits from: $(printf '%s ' "${me_flags[@]}" | sed 's/--me //g')" >&2
fi

exec python3 "$SKILL" "${roots[@]}" "${me_flags[@]}" "$@"
