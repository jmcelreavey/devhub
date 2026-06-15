#!/usr/bin/env bash
# scan-leaks.sh — fail if internal service names or obvious secrets appear in content.
# Single source of truth for the leak denylist; used by CI, the pre-push hook, and
# devhub-backport.
#
# Usage:
#   scan-leaks.sh           # scan tracked shared content (default)
#   scan-leaks.sh tree      # same
#   scan-leaks.sh stdin     # scan piped content (e.g. added diff lines)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Internal service codenames that must never appear in public/shared content.
DENY='sigyn|gefjon|bifrost|fenrir|svapi|heimdall|forseti|skadi'
# High-signal secret patterns.
SECRET='AKIA[0-9A-Z]{16}|-----BEGIN[ A-Z]*PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}|ghp_[0-9A-Za-z]{36}'
PATTERN="${DENY}|${SECRET}"

mode="${1:-tree}"
hits=""
case "$mode" in
  stdin)
    hits="$(grep -nEiI "$PATTERN" - 2>/dev/null || true)"
    ;;
  tree)
    # Tracked files, excluding this scanner, the strategy doc, internal review docs,
    # personal data, and the backport script (all legitimately reference the denylist).
    hits="$(cd "$ROOT" && git ls-files -- \
              ':!notes' ':!tasks' ':!TEMPLATE_AND_PLUGIN_PLAN.md' \
              ':!scripts/scan-leaks.sh' ':!scripts/devhub-backport.sh' \
              ':(exclude,glob)docs/codebase-review-*.md' \
            | tr '\n' '\0' \
            | xargs -0 grep -nEiI "$PATTERN" 2>/dev/null || true)"
    ;;
  *)
    echo "usage: scan-leaks.sh [tree|stdin]" >&2
    exit 2
    ;;
esac

if [[ -n "$hits" ]]; then
  echo "✗ Leak scan FAILED — internal service names or secrets found:" >&2
  echo "$hits" | head -50 | sed 's/^/  /' >&2
  exit 1
fi
echo "✓ Leak scan passed."
