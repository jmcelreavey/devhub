# Keep the runner available when a Git write changes the checked-out scripts.
setup_git_lock() {
  GIT_LOCK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/devhub-git-lock.XXXXXX")"
  mkdir -p "$GIT_LOCK_DIR/scripts" "$GIT_LOCK_DIR/apps/core/src/lib/git" "$GIT_LOCK_DIR/packages/shared/process"
  cp "$REPO_ROOT/scripts/git-locked.mjs" "$GIT_LOCK_DIR/scripts/"
  cp "$REPO_ROOT/apps/core/src/lib/git/mutation-queue.ts" "$GIT_LOCK_DIR/apps/core/src/lib/git/"
  cp "$REPO_ROOT/apps/core/src/lib/process-lock.ts" "$GIT_LOCK_DIR/apps/core/src/lib/"
  cp "$REPO_ROOT/packages/shared/process/directory-lock.ts" "$GIT_LOCK_DIR/packages/shared/process/"
}

cleanup_git_lock() {
  [[ -z "${GIT_LOCK_DIR:-}" ]] || rm -rf "$GIT_LOCK_DIR"
}

# Use the dashboard's process lock, including its inherited leases for Git hooks.
git_write() {
  node --disable-warning=ExperimentalWarning --experimental-strip-types "$GIT_LOCK_DIR/scripts/git-locked.mjs" "$@"
}
