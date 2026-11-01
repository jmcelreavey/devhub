#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ] || [[ "$1" == -* ]]; then
  echo 'Usage: clean-clone.sh <sha> <new-destination>' >&2
  exit 2
fi

SOURCE="$(cd "$(dirname "$0")/../.." && pwd)"
source "$SOURCE/scripts/lib/public-paths.sh"
SHA="$(git -C "$SOURCE" rev-parse --verify "$1^{commit}")"
paths=()
for entry in "${PUBLIC_PATHS[@]}"; do
  case "$entry" in
    :*) paths+=("$entry") ;;
    *) if git -C "$SOURCE" cat-file -e "$SHA:$entry" 2>/dev/null; then paths+=("$entry"); fi ;;
  esac
done
for entry in "${PERSONAL_PATHS[@]}"; do paths+=(":(exclude)$entry"); done
paths+=(':(exclude,glob)**/.env*')

mkdir "$2"
git -C "$SOURCE" archive "$SHA" -- "${paths[@]}" | tar -xf - -C "$2"
git -C "$2" init --quiet --template=
git -C "$2" -c core.excludesFile=/dev/null add --force --all
git -C "$2" -c user.name='DevHub target fixture' -c user.email=fixture@localhost \
  -c core.hooksPath=/dev/null commit --quiet -m "Fixture from $SHA"
printf 'Created independent public-only fixture from %s in %s\n' "$SHA" "$2"
