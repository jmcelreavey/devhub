#!/usr/bin/env bash
#
# Record the README demo (docs/assets/demos/dashboard.gif): a walk through the real
# dashboard, driven by Playwright, against disposable demo data.
#
# Why a fixture: the demo syncs persona into tool configs under $HOME and writes notes
# and tasks. Pointed at a real machine it would record and overwrite real data. So this
# builds a throwaway checkout (committed content only — no notes, tasks or identity), a
# throwaway HOME, seeded demo notes/tasks, and a scrubbed environment (`env -i`), so no
# integration secrets, plugins or 1Password items reach the recording.
#
# Usage:  npm run demos:record
# Env:    DEVHUB_DEMO_FIXTURE (default /tmp/devhub-demo-fixture — its path shows on screen)
#         DEVHUB_DEMO_REF     (default HEAD — the commit to record)
#         DEVHUB_DEMO_PORT    (default 1350)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="${DEVHUB_DEMO_FIXTURE:-/tmp/devhub-demo-fixture}"
REF="${DEVHUB_DEMO_REF:-HEAD}"
PORT="${DEVHUB_DEMO_PORT:-1350}"
MARKER="$FIXTURE/.devhub-demo-fixture"
APP="$FIXTURE/devhub"
OUT="$REPO_ROOT/docs/assets/demos/dashboard.gif"

for dep in dashboard/node_modules mcp-servers/devhub-server/node_modules; do
  if [ ! -d "$REPO_ROOT/$dep" ]; then
    echo "$dep is missing — run npm install first" >&2
    exit 1
  fi
done
if [ ! -d "$HOME/Library/Caches/ms-playwright" ] && [ ! -d "$HOME/.cache/ms-playwright" ]; then
  echo "Playwright browsers are missing — run: npx --prefix dashboard playwright install chromium" >&2
  exit 1
fi
if curl -s -o /dev/null "http://127.0.0.1:$PORT"; then
  echo "port $PORT is in use — set DEVHUB_DEMO_PORT" >&2
  exit 1
fi

# DEVHUB_DEMO_FIXTURE is user-overridable, so never rm -rf a directory we did not create.
if [ -e "$FIXTURE" ] && [ ! -e "$MARKER" ]; then
  echo "$FIXTURE exists and is not a demo fixture — refusing to delete it" >&2
  exit 1
fi

echo "Building fixture at $FIXTURE from $REF"
rm -rf "$FIXTURE"
mkdir -p "$FIXTURE"/{home,notes/.config,tasks,collections,reps,upstarts,repos,opcache} "$APP"
touch "$MARKER"
# Marks 1Password as already consulted, so startup never calls `op`.
touch "$FIXTURE/opcache/.env.op-synced"
git -C "$REPO_ROOT" archive "$REF" -- . ':!notes' ':!tasks' ':!collections' ':!reps' ':!upstarts' ':!persona/identity.txt' |
  tar -x -C "$APP"
git -C "$APP" init -q
git -C "$APP" add -A
git -C "$APP" -c user.name=DevHub -c user.email=demo@devhub.invalid commit -qm "Demo fixture"
ln -s "$REPO_ROOT/dashboard/node_modules" "$APP/dashboard/node_modules"
ln -s "$REPO_ROOT/mcp-servers/devhub-server/node_modules" "$APP/mcp-servers/devhub-server/node_modules"

# Briefing weather/events default to the maintainer's area; pin a neutral city.
cat >"$FIXTURE/notes/.config/briefing-prefs.json" <<'JSON'
{ "version": 1, "prefs": { "location": { "name": "London", "lat": 51.5074, "lon": -0.1278 }, "eventSearchAreas": ["London"] } }
JSON

NODE_DIR="$(dirname "$(command -v node)")"
demo_env() {
  env -i \
    HOME="$FIXTURE/home" USER=demo LOGNAME=demo TERM=xterm-256color LANG=en_US.UTF-8 \
    PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    REPO_ROOT="$APP" NEXT_PUBLIC_REPO_ROOT="$APP" \
    NOTES_DIR="$FIXTURE/notes" TASKS_DIR="$FIXTURE/tasks" COLLECTIONS_DIR="$FIXTURE/collections" \
    REPS_DIR="$FIXTURE/reps" UPSTARTS_DIR="$FIXTURE/upstarts" DEVHUB_REPOS_DIR="$FIXTURE/repos" \
    DEVHUB_OP_CACHE_DIR="$FIXTURE/opcache" DEVHUB_ENV_FILE="$FIXTURE/env.local" \
    PORT="$PORT" DEVHUB_BIND_HOST=127.0.0.1 DEVHUB_BASE_URL="http://127.0.0.1:$PORT" \
    NEXT_TELEMETRY_DISABLED=1 AI_TOOLS_SYNC=0 DEVHUB_MCP_HTTP=0 \
    "$@"
}

# Committed branding baselines can carry a plugin's whitelabel; the fixture has no plugins.
(cd "$APP/dashboard" && demo_env ./node_modules/.bin/tsx scripts/run-action.ts sync_plugins >/dev/null)

echo "Seeding demo notes and tasks over the DevHub MCP server"
mcp() { demo_env node "$APP/mcp-servers/devhub-server/scripts/call-tool.mjs" "$@" >/dev/null 2>&1; }
mcp notes_write '{"path":"learnings/npm-11-lockfile","content":"# npm 11 rewrites package-lock.json\n\nCI runs Node 22 / npm 10. npm 11 regenerates the lockfile in a shape npm 10 rejects, so CI fails with `Missing: <pkg> from lock file`.\n\n**Fix:** `nvm use` before `npm install`. The preinstall gate refuses other npm majors.\n\n#ci #node"}'
mcp notes_write '{"path":"learnings/playwright-waits","content":"# Wait for hydration, not domcontentloaded\n\nContenteditable and canvas widgets are inert until React hydrates. Assert an enabled control first, then interact.\n\n#testing"}'
mcp notes_write '{"path":"meetings/checkout-retro","content":"# Checkout retro\n\n## What went wrong\n\n- Retry storm on the payments webhook after the queue backed up\n- Alert fired 40 minutes after customers noticed\n\n## Actions\n\n- [ ] Cap webhook retries with jitter\n- [ ] Page on queue age, not queue depth\n- [x] Write up the timeline"}'
mcp notes_write '{"path":"projects/search-rewrite","content":"# Search rewrite\n\nMove from LIKE queries to Postgres full-text search with a trigram fallback for typos.\n\n## Open questions\n\n- Backfill tsvector columns online or in a maintenance window?\n- Ranking: ts_rank_cd or a simple recency boost\n\n#search"}'
mcp tasks_create '{"text":"Cap webhook retries with jitter #payments","withNote":true}'
mcp tasks_create '{"text":"Review search rewrite plan #search"}'
mcp tasks_create '{"text":"Page on queue age instead of depth #payments"}'
mcp tasks_create '{"text":"Pin Node 22 in the deploy image #ci"}'

echo "Starting dashboard on :$PORT"
set -m # own process group, so cleanup stops Next's child processes too
(cd "$APP/dashboard" && demo_env ./node_modules/.bin/tsx scripts/run-next-with-env.ts dev --port "$PORT" --hostname 127.0.0.1) \
  >"$FIXTURE/dashboard.log" 2>&1 &
SERVER_PID=$!
set +m
trap 'kill -- -"$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 180); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/setup/status" && break
  sleep 1
done
if ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/setup/status"; then
  echo "dashboard did not start — see $FIXTURE/dashboard.log" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
(cd "$REPO_ROOT/dashboard" &&
  DEMO_URL="http://127.0.0.1:$PORT" DEMO_OUT="$OUT" DEMO_FRAMES_DIR="$FIXTURE/frames" \
    ./node_modules/.bin/tsx scripts/record-readme-demo.ts)

if [ ! -s "$OUT" ]; then
  echo "recording produced no GIF at $OUT" >&2
  exit 1
fi

echo
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "Key frames are in $FIXTURE/frames — review every one before publishing."
