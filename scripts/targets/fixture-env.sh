#!/usr/bin/env bash
# Run the shared gate in a clean, disposable environment. See README.md.
set -euo pipefail

: "${CHECKOUT:?Set CHECKOUT to an absolute path to an independent clone}"
case "$CHECKOUT" in /*) ;; *) echo 'CHECKOUT must be absolute' >&2; exit 1 ;; esac
test -d "$CHECKOUT/.git" || { echo 'CHECKOUT must be an independent clone, not a worktree' >&2; exit 1; }
if [ -f "$CHECKOUT/apps/ui/package.json" ]; then
  UI_DIR="$CHECKOUT/apps/ui"
else
  echo 'Cannot find the UI package' >&2; exit 1
fi
for dir in "$CHECKOUT" "$UI_DIR"; do
  for name in .env .env.local .env.development .env.development.local .env.production .env.production.local .env.test .env.test.local; do
    test ! -e "$dir/$name" || { echo "Remove copied configuration from the disposable clone first: $dir/$name" >&2; exit 1; }
  done
done

FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/devhub-target.XXXXXX")"
mkdir -p "$FIXTURE"/{home,tmp,config,app-data,repos,plugins,plugin-target,migrations,agent-runs,terminal-logs,content/{notes,tasks,collections,docs,reps,upstarts}}
echo "Fixture: $FIXTURE"
exec env -i PATH="$PATH" USER="${USER:-tester}" SHELL=/bin/bash HOME="$FIXTURE/home" \
  FIXTURE="$FIXTURE" CHECKOUT="$CHECKOUT" TMPDIR="$FIXTURE/tmp" \
  XDG_CONFIG_HOME="$FIXTURE/home/.config" XDG_DATA_HOME="$FIXTURE/home/.local/share" \
  XDG_STATE_HOME="$FIXTURE/home/.local/state" XDG_CACHE_HOME="$FIXTURE/home/.cache" \
  GIT_CONFIG_NOSYSTEM=1 REPO_ROOT="$CHECKOUT" DEVHUB_CONTENT_ROOT="$FIXTURE/content" \
  NOTES_DIR="$FIXTURE/content/notes" TASKS_DIR="$FIXTURE/content/tasks" \
  COLLECTIONS_DIR="$FIXTURE/content/collections" DOCS_DIR="$FIXTURE/content/docs" \
  REPS_DIR="$FIXTURE/content/reps" UPSTARTS_DIR="$FIXTURE/content/upstarts" \
  DEVHUB_CONFIG_DIR="$FIXTURE/config" DEVHUB_APP_DATA="$FIXTURE/app-data" \
  DEVHUB_REPOS_DIR="$FIXTURE/repos" DEVHUB_DEVELOPER_DIR="$FIXTURE/home" \
  DEVHUB_PLUGIN_HOME="$FIXTURE/plugins" DEVHUB_PLUGIN_TARGET_HOME="$FIXTURE/plugin-target" \
  DEVHUB_TASK_MIGRATION_DIR="$FIXTURE/migrations" DEVHUB_AGENT_RUNS_DIR="$FIXTURE/agent-runs" \
  DEVHUB_TERMINAL_LOG_DIR="$FIXTURE/terminal-logs" DEVHUB_TERMINAL_SHELL=/bin/bash \
  DEVHUB_TERMINAL_ARGS='--noprofile --norc -i' DEVHUB_TERMINAL_SHELL_INTEGRATION=0 \
  DEVHUB_SCHEDULER=0 DEVHUB_MCP_HTTP=0 DEVHUB_CORE_SERVER=1 DEVHUB_SKIP_POSTINSTALL=1 \
  TARGET_PORT="${TARGET_PORT:-1437}" TARGET_TERMINAL_PORT="${TARGET_TERMINAL_PORT:-1439}" \
  TARGET_MCP_PORT="${TARGET_MCP_PORT:-1440}" \
  NODE_OPTIONS="${NODE_OPTIONS:-}" PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-}" \
  WSL_DISTRO_NAME="${WSL_DISTRO_NAME:-}" WSL_INTEROP="${WSL_INTEROP:-}" \
  bash --noprofile --norc "$CHECKOUT/scripts/targets/targets-gate.sh" "$@"
