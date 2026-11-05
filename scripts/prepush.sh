#!/usr/bin/env bash
# Pre-push checks, also runnable through npm run prepush.
#
# DEVHUB_SKIP_VERIFY=1     bypass everything, leak scan included (emergencies).
# DEVHUB_PREPUSH=content   set by the app's content sync only. Skips
#                          verify when every commit being pushed touches only
#                          content folders; the leak check still runs.
#                          Any other file in the push runs verify.
set -e

if [[ "${DEVHUB_SKIP_VERIFY:-0}" == "1" ]]; then
    echo "[pre-push] DEVHUB_SKIP_VERIFY=1 — skipping checks."
    exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
PUSH_REFS=""
if [[ $# -gt 0 ]]; then
    PUSH_REFS="$(cat)"
fi

CONTENT_PATHS=(notes collections tasks docs diagrams upstarts)

is_content_path() {
    local file="$1" folder
    # Timers stay on the machine that made them; never treat them as syncable content.
    case "$file" in
        tasks/.local | tasks/.local/* | tasks/*/.local | tasks/*/.local/*) return 1 ;;
    esac
    for folder in "${CONTENT_PATHS[@]}"; do
        [[ "$file" == "$folder" || "$file" == "$folder/"* ]] && return 0
    done
    return 1
}

# stdin is git's "<local ref> <local sha> <remote ref> <remote sha>" lines.
# Prints why the push is NOT content-only (a file, or a failure to tell), and
# nothing when every commit touches only content paths. Fails closed: if we
# can't list the commits, verify runs.
non_content_reason() {
    local remote="$1" local_ref local_sha remote_ref remote_sha commits commit file files
    while read -r local_ref local_sha remote_ref remote_sha; do
        [[ -n "$local_sha" ]] || continue
        [[ "$local_sha" =~ ^0+$ ]] && continue # deleting a ref pushes no commits
        if [[ "$remote_sha" =~ ^0+$ ]] || ! git cat-file -e "${remote_sha}^{commit}" 2>/dev/null; then
            # New remote ref, or a tip this clone has not fetched yet (the
            # content-sync service moves it constantly). Everything the remote
            # doesn't already have is still the right question.
            commits="$(git rev-list "$local_sha" --not --remotes="$remote" 2>/dev/null)" \
                || { echo "could not list the new commits on $local_ref"; return; }
        else
            commits="$(git rev-list "$remote_sha..$local_sha" 2>/dev/null)" \
                || { echo "could not list the commits on $local_ref"; return; }
        fi
        for commit in $commits; do
            # -m so a merge is judged against each parent; --no-renames so a move
            # out of a content folder lists both paths.
            files="$(git diff-tree --no-commit-id --name-only -r -m --no-renames --root "$commit" 2>/dev/null)" \
                || { echo "could not list files in ${commit:0:9}"; return; }
            while IFS= read -r file; do
                [[ -n "$file" ]] || continue
                if ! is_content_path "$file"; then
                    echo "${commit:0:9} touches $file"
                    return
                fi
            done <<< "$files"
        done
    done <<< "$2"
}

CONTENT_ONLY=0
if [[ "${DEVHUB_PREPUSH:-}" == "content" && $# -gt 0 ]]; then
    NON_CONTENT="$(non_content_reason "$1" "$PUSH_REFS")"
    if [[ -z "$NON_CONTENT" ]]; then
        CONTENT_ONLY=1
    else
        echo "[pre-push] DEVHUB_PREPUSH=content, but $NON_CONTENT — running verify."
    fi
fi

# Verify needs the repo's pinned Node (.nvmrc) — pushes from shells without nvm
# loaded (IDEs, GUI clients, plain terminals) would otherwise run vitest under
# an older system Node and false-fail. Source nvm here when node doesn't match.
if [[ "$CONTENT_ONLY" != "1" && -f "$REPO_ROOT/.nvmrc" ]]; then
    WANT_NODE="$(tr -d '[:space:]' < "$REPO_ROOT/.nvmrc")"
    HAVE_NODE="$(node --version 2>/dev/null || true)"
    case "${HAVE_NODE#v}" in
        "$WANT_NODE" | "$WANT_NODE".*) : ;; # already on the pinned major
        *)
            export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
            if [[ -s "$NVM_DIR/nvm.sh" ]]; then
                # shellcheck disable=SC1091
                . "$NVM_DIR/nvm.sh" --no-use
                nvm use --silent "$WANT_NODE" >/dev/null 2>&1 || true
            fi
            HAVE_NODE="$(node --version 2>/dev/null || echo none)"
            case "${HAVE_NODE#v}" in
                "$WANT_NODE" | "$WANT_NODE".*)
                    echo "[pre-push] Using Node $HAVE_NODE via nvm (.nvmrc: $WANT_NODE)." ;;
                *)
                    echo "[pre-push] WARNING: Node $HAVE_NODE does not match .nvmrc ($WANT_NODE) and nvm couldn't switch — verify may fail. Run 'nvm install $WANT_NODE'." ;;
            esac
            ;;
    esac
fi

echo "[pre-push] Scanning for internal-name / secret leaks…"
if ! bash "$REPO_ROOT/scripts/scan-leaks.sh" tree; then
    echo "[pre-push] Leak scan failed. Fix the hits above or set DEVHUB_SKIP_VERIFY=1 to override."
    exit 1
fi

# Content-only push from the app: verify covers code that isn't in this push.
if [[ "$CONTENT_ONLY" == "1" ]]; then
    echo "[pre-push] DEVHUB_PREPUSH=content and every pushed commit is content-only — skipping verify (leak check passed)."
    exit 0
fi

if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    echo "[pre-push] node_modules missing — run npm ci at the repo root."
    exit 1
fi

# Desktop sidecars, IDE shells and Git leave runtime variables that tests must not inherit.
if [[ "${NODE_ENV:-}" == "production" ]]; then
    unset NODE_ENV
fi
unset PORT NOTES_DIR TASKS_DIR COLLECTIONS_DIR UPSTARTS_DIR DOCS_DIR
while IFS= read -r key; do
    case "$key" in
        DEVHUB_OP_*|DEVHUB_REPOS_DIR|DEVHUB_ALLOWED_DEV_ORIGINS|DEVHUB_GIT_LEASES) ;;
        DEVHUB_*|GIT_*|__NEXT_PRIVATE_*) unset "$key" ;;
    esac
done < <(env | awk -F= '/^(DEVHUB_|GIT_|__NEXT_PRIVATE_)/ { print $1 }')

cd "$REPO_ROOT"
trap 'echo "[pre-push] Verify failed. Fix the errors above or set DEVHUB_SKIP_VERIFY=1 to override." >&2' ERR
CHANGED_FILES="$(mktemp "${TMPDIR:-/tmp}/devhub-prepush.XXXXXX")"
trap 'rm -f "$CHANGED_FILES"' EXIT

if [[ $# -gt 0 ]]; then
    while read -r local_ref local_sha remote_ref remote_sha; do
        [[ -n "$local_sha" && ! "$local_sha" =~ ^0+$ ]] || continue
        if [[ "$remote_sha" =~ ^0+$ ]] || ! git cat-file -e "${remote_sha}^{commit}" 2>/dev/null; then
            commits="$(git rev-list "$local_sha" --not --remotes="$1")"
        else
            commits="$(git rev-list "$remote_sha..$local_sha")"
        fi
        for commit in $commits; do
            git diff-tree --no-commit-id --name-only -z -r -m --no-renames --root --diff-filter=ACMRT "$commit" >> "$CHANGED_FILES"
        done
    done <<< "$PUSH_REFS"
else
    base="$(git merge-base HEAD origin/main)"
    git diff --name-only -z --no-renames --diff-filter=ACMRT "$base" HEAD >> "$CHANGED_FILES"
fi
git diff --name-only -z --no-renames --diff-filter=ACMRT HEAD >> "$CHANGED_FILES"
git ls-files --others --exclude-standard -z >> "$CHANGED_FILES"

lint_files=()
while IFS= read -r -d '' file; do
    case "$file" in
        *.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx)
            if [[ -f "$REPO_ROOT/$file" ]]; then
                lint_files+=("$REPO_ROOT/$file")
            fi
            ;;
    esac
done < "$CHANGED_FILES"

echo "[pre-push] Checking boundaries and types…"
node scripts/check-boundaries.mjs
npm run --silent typecheck
if (( ${#lint_files[@]} )); then
    echo "[pre-push] Linting changed files…"
    npm exec -- eslint --config apps/ui/eslint.config.mjs --max-warnings 0 --no-warn-ignored "${lint_files[@]}"
fi
echo "[pre-push] Running smoke tests…"
node --test scripts/prepush.test.mjs
npm run --silent test:all -w apps/ui -- --config vitest.fast.config.ts \
    ../../apps/core/src/http/router.test.ts \
    ../../apps/core/src/lib/content/sync-paths.test.ts \
    ../../apps/core/src/lib/atomic-write.test.ts \
    ../../packages/shared/storage/contracts.test.ts \
    ../../packages/mcp/src/actions/contracts.test.ts \
    ../../tests/integration/ui-core/scripts/terminal-pty-server.test.ts

echo "[pre-push] All checks passed."
