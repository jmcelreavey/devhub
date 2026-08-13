#!/usr/bin/env bash
#
# Record the vendored-skill demos against the synthetic fixture.
#
# Why a wrapper rather than `vhs *.tape`: the tapes must never be pointed at a
# real repository. project-graveyard's report names abandoned projects and reads
# commit emails; the archaeologist prints commit subjects and author addresses.
# `docs/contributing/recording-demos.md` requires disposable fixtures and a
# frame-by-frame review before publishing, and the cheapest way to honour that
# is to make the safe path the only path — this script builds a throwaway
# fixture and refuses to run without it.
#
# Usage:  npm run skills:demos
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="${DEVHUB_FIXTURE:-/tmp/devhub-skill-fixture}"
OUT="$REPO_ROOT/docs/assets/demos"

if ! command -v vhs >/dev/null 2>&1; then
  echo "vhs is not installed. brew install vhs" >&2
  exit 1
fi

echo "Building fixture at $FIXTURE"
python3 "$REPO_ROOT/scripts/skill-evals/build-fixture.py" "$FIXTURE" >/dev/null

# A tape that silently records an empty terminal is worse than one that fails:
# you don't find out until someone watches the GIF.
for repo in archaeology-repo scope-repo graveyard; do
  if [ ! -e "$FIXTURE/$repo" ]; then
    echo "fixture is missing $repo — aborting rather than recording nothing" >&2
    exit 1
  fi
done

mkdir -p "$OUT"

record() {
  local tape="$1" skill_dir="$2"
  local gif="$OUT/$(basename "$tape" .tape).gif"
  echo "Recording $(basename "$tape" .tape)"

  # cd into the tape directory first. VHS resolves a relative `Output` against
  # the *caller's* working directory, not the tape's, so invoking it by absolute
  # path from the repo root writes three directories above the repo — where the
  # path does not exist, so ffmpeg errors and vhs still exits 0.
  (
    cd "$REPO_ROOT/scripts/skill-evals/demos"
    SKILL="$REPO_ROOT/skills/vendor/$skill_dir/scripts" \
    DEVHUB_FIXTURE="$FIXTURE" \
      vhs "$tape"
  )

  # vhs exits 0 even when ffmpeg could not open the output file, so success has
  # to be checked against the artefact rather than the exit code.
  if [ ! -s "$gif" ]; then
    echo "recording produced no GIF at $gif" >&2
    exit 1
  fi
}

record scope-creep-detector.tape scope-creep-detector
record commit-archaeologist.tape commit-archaeologist
record project-graveyard.tape project-graveyard

echo
echo "Wrote:"
ls -lh "$OUT" | tail -n +2 | awk '{print "  " $9 "  " $5}'
echo
echo "Review every frame before publishing. The fixture is synthetic, but the"
echo "shell prompt and any stray path are not."
