#!/usr/bin/env bash
#
# Record the README demo (docs/assets/demos/dashboard.gif) and the feature walkthroughs
# (docs/assets/demos/*.mp4 and *.gif): walks through the real dashboard, driven by Playwright,
# against disposable demo data.
#
# Why a fixture: the demo syncs persona into tool configs under $HOME and writes notes
# and tasks. Pointed at a real machine it would record and overwrite real data. So this
# builds a throwaway checkout (committed content only — no notes, tasks or identity), a
# throwaway HOME, seeded demo notes/tasks, and a scrubbed environment (`env -i`), so no
# integration secrets, plugins or 1Password items reach the recording.
#
# Usage:  npm run demos:record [-- readme|walkthroughs|all|serve]
#         readme (default) — the README GIF
#         walkthroughs     — the docs MP4s and README GIFs (needs ffmpeg); DEMO_ONLY=today,notes limits it
#         serve            — build the fixture, start the dashboard and wait, for working on a walk
# Env:    DEVHUB_DEMO_FIXTURE (default /tmp/devhub-demo-fixture — its path shows on screen)
#         DEVHUB_DEMO_REF     (default HEAD — the commit to record)
#         DEVHUB_DEMO_PORT    (default 1350)
#         DEVHUB_DEMO_SERVER  (default start — a production build, so clips don't stall on
#                              dev compiles; dev skips the ~1 min build while iterating)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="${DEVHUB_DEMO_FIXTURE:-/tmp/devhub-demo-fixture}"
REF="${DEVHUB_DEMO_REF:-HEAD}"
PORT="${DEVHUB_DEMO_PORT:-1350}"
MODE="${1:-readme}"
SERVER="${DEVHUB_DEMO_SERVER:-start}"
case "$MODE" in readme | walkthroughs | all | serve) ;; *) echo "unknown mode: $MODE" >&2; exit 2 ;; esac
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
if { [ "$MODE" = walkthroughs ] || [ "$MODE" = all ]; } && ! command -v ffmpeg >/dev/null; then
  echo "ffmpeg is required for walkthroughs (brew install ffmpeg)" >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null; then
  echo "sqlite3 is required to seed the demo database — install the SQLite CLI first" >&2
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
# A symlink is not matched by the `node_modules/` ignore rule; without this Status shows a dirty path.
echo "/mcp-servers/devhub-server/node_modules" >>"$APP/.git/info/exclude"

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
    NEXT_TELEMETRY_DISABLED=1 AI_TOOLS_SYNC=0 DEVHUB_MCP_HTTP=0 DEVHUB_SCHEDULER=0 \
    DEVHUB_PASEO_URL=ws://127.0.0.1:9/ws \
    "$@"
}

# DEVHUB_PASEO_URL points at a dead port: the real Paseo daemon on :6767 holds real chats.

# Committed branding baselines can carry a plugin's whitelabel; the fixture has no plugins.
(cd "$APP/dashboard" && demo_env ./node_modules/.bin/tsx scripts/run-action.ts sync_plugins >/dev/null)

# Sync skills, agents, MCP and persona into the throwaway HOME, so Status opens healthy.
(cd "$APP/dashboard" && demo_env ./node_modules/.bin/tsx scripts/run-action.ts sync >"$FIXTURE/sync.log" 2>&1) ||
  echo "warning: initial tool sync failed — see $FIXTURE/sync.log" >&2

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
mcp notes_write '{"path":"projects/payments-hardening","content":"# Payments hardening\n\nFollow-ups from the [checkout retro](/notes/meetings/checkout-retro).\n\n- Retries with jitter\n- Queue-age paging\n- Idempotency keys on the webhook handler\n\n#payments"}'
mcp diagrams_create '{"name":"architecture/checkout-flow"}'
mcp diagrams_set_graph '{"path":"architecture/checkout-flow","title":"Checkout flow","direction":"right","nodes":[{"id":"web","label":"Web checkout"},{"id":"api","label":"Payments API"},{"id":"psp","label":"Card processor"},{"id":"hook","label":"Webhook handler"},{"id":"queue","label":"Retry queue"},{"id":"ledger","label":"Ledger"}],"edges":[{"from":"web","to":"api"},{"from":"api","to":"psp"},{"from":"psp","to":"hook","label":"events"},{"from":"hook","to":"queue","label":"on failure"},{"from":"hook","to":"ledger"}]}'

# Earlier days, so Work → History and the weekly review have something to show. All of them
# are completed: open tasks on a past day would roll over and clutter Today.
past_tasks=("Triage flaky checkout e2e test #ci" "Draft retro timeline #payments" "Rotate staging API keys #ops"
  "Review queue-age alert thresholds #payments" "Pair on search ranking spike #search" "Update onboarding doc #docs")
for offset in 1 2 3; do
  day="$(date -v-"$offset"d +%F 2>/dev/null || date -d "-$offset day" +%F)"
  for i in 0 1; do
    mcp tasks_create "{\"text\":\"${past_tasks[$(((offset - 1) * 2 + i))]}\",\"date\":\"$day\"}"
  done
  for id in $(node -e 'for (const t of require(process.argv[1])) console.log(t.id)' "$FIXTURE/tasks/$day.json"); do
    mcp tasks_update "{\"id\":\"$id\",\"date\":\"$day\",\"done\":true}"
  done
done

# Two small repos with history, for the Repos walkthrough.
for repo in payments-api search-service; do
  r="$FIXTURE/repos/$repo"
  mkdir -p "$r/src"
  git -C "$r" init -q -b main
  printf '# %s\n\nDemo repository.\n' "$repo" >"$r/README.md"
  git -C "$r" add -A && git -C "$r" -c user.name='Alex Demo' -c user.email=alex@devhub.invalid commit -qm "chore: scaffold $repo"
  for msg in "feat: add health endpoint" "fix: retry webhook with jitter" "docs: document local setup"; do
    echo "// $msg" >>"$r/src/index.ts"
    git -C "$r" add -A && git -C "$r" -c user.name='Sam Demo' -c user.email=sam@devhub.invalid commit -qm "$msg"
  done
  echo "// work in progress" >>"$r/src/index.ts"
done

# Conventions lists clones that have a GitHub remote. The URL is never fetched; it only lets
# the page recognise the repo, and the seeded file gives it learned rules to show. The repo,
# reviewers and comments are invented.
git -C "$FIXTURE/repos/search-service" remote add origin https://github.com/acme-co/search-service.git
mkdir -p "$FIXTURE/notes/.config/conventions"
cat >"$FIXTURE/notes/.config/conventions/acme-co__search-service.json" <<'JSON'
{
  "version": 1,
  "repo": "acme-co/search-service",
  "rules": [
    {
      "id": "r_1a2b3c4d", "text": "Put each HTTP handler in its own file under src/handlers/, named after the route.",
      "why": "Keeps handler diffs reviewable and stops routes.ts growing without bound.",
      "category": "structure", "scope": "src/handlers/**", "status": "accepted", "origin": "review", "acceptedBy": "pr",
      "evidence": [{ "kind": "review", "url": "https://github.com/acme-co/search-service/pull/214#discussion_r1001", "label": "PR #214 · reviewer-a", "prNumber": 214, "author": "reviewer-a", "path": "src/routes.ts", "quote": "We usually do one file per handler. Can you split this out?", "actedOn": true }],
      "prs": [214], "firstSeen": "2026-09-30T09:12:00.000Z", "lastSeen": "2026-10-04T16:40:00.000Z",
      "automaticDecision": { "status": "accepted", "reason": "A team member stated the pattern and the PR author split the file afterwards.", "at": "2026-10-04T16:40:00.000Z" }
    },
    {
      "id": "r_5e6f7a8b", "text": "Read the search index name from config.search.index instead of adding an environment variable.",
      "category": "config", "status": "accepted", "origin": "review", "acceptedBy": "pr",
      "evidence": [{ "kind": "review", "url": "https://github.com/acme-co/search-service/pull/201#discussion_r1002", "label": "PR #201 · reviewer-b", "prNumber": 201, "author": "reviewer-b", "path": "src/config.ts", "quote": "Config lives under search.*. Please don't add another env var for this.", "actedOn": true }],
      "prs": [201], "firstSeen": "2026-09-28T11:02:00.000Z", "lastSeen": "2026-10-04T16:40:00.000Z",
      "automaticDecision": { "status": "accepted", "reason": "Repeated reviewer guidance, and the author moved the value into config.", "at": "2026-10-04T16:40:00.000Z" }
    },
    {
      "id": "r_9c0d1e2f", "text": "Keep test fixtures next to the test that uses them, in a __fixtures__ folder.",
      "category": "testing", "scope": "**/*.test.ts", "status": "accepted", "origin": "review",
      "evidence": [{ "kind": "review", "url": "https://github.com/acme-co/search-service/pull/198#discussion_r1003", "label": "PR #198 · reviewer-a", "prNumber": 198, "author": "reviewer-a", "path": "test/ranking.test.ts", "quote": "Our pattern is fixtures beside the test, not in a shared test-data dir." }],
      "prs": [198, 226], "firstSeen": "2026-09-27T14:20:00.000Z", "lastSeen": "2026-10-05T10:05:00.000Z",
      "automaticDecision": { "status": "accepted", "reason": "Stated as a team pattern in two separate PRs.", "at": "2026-10-05T10:05:00.000Z" }
    },
    {
      "id": "r_3a4b5c6d", "text": "Wrap upstream errors with the request id before rethrowing them.",
      "category": "errors", "status": "accepted", "origin": "review",
      "evidence": [{ "kind": "review", "url": "https://github.com/acme-co/search-service/pull/226#discussion_r1004", "label": "PR #226 · reviewer-c", "prNumber": 226, "author": "reviewer-c", "path": "src/client.ts", "quote": "Wrap this with the request id, otherwise the logs can't be joined." }],
      "prs": [226], "firstSeen": "2026-10-05T10:05:00.000Z", "lastSeen": "2026-10-05T10:05:00.000Z",
      "automaticDecision": { "status": "accepted", "reason": "Concrete, durable expectation with a clear reason.", "at": "2026-10-05T10:05:00.000Z" }
    },
    {
      "id": "r_7e8f9a0b", "text": "Add a changelog line for any user-visible ranking change.",
      "category": "process", "status": "accepted", "origin": "guidance",
      "evidence": [{ "kind": "guidance", "url": "https://github.com/acme-co/search-service/blob/main/AGENTS.md", "label": "AGENTS.md", "quote": "Ranking changes need a CHANGELOG entry." }],
      "prs": [], "firstSeen": "2026-09-27T14:20:00.000Z", "lastSeen": "2026-10-05T10:05:00.000Z",
      "automaticDecision": { "status": "accepted", "reason": "Written down in the repo's own guidance.", "at": "2026-09-27T14:20:00.000Z" }
    },
    {
      "id": "r_1b2c3d4e", "text": "Use tabs for indentation.",
      "category": "style", "status": "rejected", "origin": "review",
      "evidence": [{ "kind": "review", "url": "https://github.com/acme-co/search-service/pull/190#discussion_r1005", "label": "PR #190 · reviewer-b", "prNumber": 190, "author": "reviewer-b", "path": "src/index.ts", "quote": "I prefer tabs here." }],
      "prs": [190], "firstSeen": "2026-09-26T08:00:00.000Z", "lastSeen": "2026-09-26T08:00:00.000Z",
      "automaticDecision": { "status": "rejected", "reason": "Personal preference, and the formatter config already decides this.", "at": "2026-09-26T08:00:00.000Z" }
    }
  ],
  "minedPrs": { "190": "a1", "198": "b2", "201": "c3", "214": "d4", "226": "e5" },
  "guidanceHash": "demo",
  "checkedAt": "2026-10-05T10:05:00.000Z",
  "runs": [
    { "at": "2026-10-05T10:05:00.000Z", "trigger": "review", "ok": true, "prsScanned": 30, "comments": 41, "considered": 52, "added": 2, "autoAccepted": 2, "autoRejected": 0, "reinforced": 1, "ms": 8400, "provider": "claude", "model": "default", "guidanceFiles": ["AGENTS.md"] }
  ]
}
JSON

# A task linked to that repo, with a plan, so Implement with Agent… opens on a clean readiness checklist.
impl_out="$(demo_env node "$APP/mcp-servers/devhub-server/scripts/call-tool.mjs" tasks_create \
  '{"text":"Cache search results per tenant #search","withNote":true,"links":[{"kind":"repo","id":"acme-co/search-service","label":"search-service"}]}' 2>&1)"
impl_note="$(printf '%s\n' "$impl_out" | sed -n 's/^Linked note: //p')"
if [ -z "$impl_note" ]; then
  echo "could not seed the Implement demo task: $impl_out" >&2
  exit 1
fi
mcp notes_append "{\"path\":\"$impl_note\",\"content\":\"## Plan\\n\\nKey the result cache by tenant id and query hash in src/search/cache.ts, with a 60 second TTL. Invalidate a tenant's entries when its index is rebuilt.\\n\\n## Acceptance\\n\\n- A second identical query for the same tenant is served from cache\\n- One tenant's results are never returned to another\\n- Rebuilding the index clears that tenant's entries\\n\"}"

# A SQLite file inside a repo: /db lists the .db files it finds in tracked repos, so the
# Databases walkthrough needs no connection setup. Excluded so the git client's changes
# list stays about the demo edit, not a binary.
sqlite3 "$FIXTURE/repos/payments-api/orders.db" <<'SQL'
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO customers (id, name, country) VALUES
  (1, 'Northwind Traders', 'GB'), (2, 'Contoso Ltd', 'US'), (3, 'Fabrikam', 'DE'), (4, 'Tailspin Toys', 'IE');
INSERT INTO orders (customer_id, total_cents, status, created_at) VALUES
  (1, 12900, 'paid', '2026-09-28'), (2, 4500, 'paid', '2026-09-29'), (3, 78000, 'refunded', '2026-09-29'),
  (1, 2300, 'paid', '2026-09-30'), (4, 15600, 'failed', '2026-10-01'), (2, 9900, 'paid', '2026-10-01'),
  (3, 31000, 'paid', '2026-10-02'), (4, 6400, 'paid', '2026-10-03'), (1, 54000, 'failed', '2026-10-03');
SQL
echo "orders.db" >>"$FIXTURE/repos/payments-api/.git/info/exclude"

if [ "$SERVER" = start ]; then
  echo "Building the dashboard (production)"
  # Webpack, not Turbopack: Turbopack rejects the fixture's symlinked node_modules.
  if ! (cd "$APP/dashboard" && demo_env DEVHUB_SKIP_NEXT_TYPECHECK=true \
    NODE_OPTIONS='--max-old-space-size=6144 --no-deprecation' ./node_modules/.bin/next build --webpack) \
    >"$FIXTURE/build.log" 2>&1; then
    echo "build failed — see $FIXTURE/build.log" >&2
    exit 1
  fi
fi

echo "Starting dashboard ($SERVER) on :$PORT"
set -m # own process group, so cleanup stops Next's child processes too
(cd "$APP/dashboard" && demo_env ./node_modules/.bin/tsx scripts/run-next-with-env.ts "$SERVER" --port "$PORT" --hostname 127.0.0.1) \
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

if [ "$MODE" = serve ]; then
  echo "Fixture dashboard: http://127.0.0.1:$PORT  (Ctrl-C to stop)"
  wait "$SERVER_PID"
  exit 0
fi

if [ "$MODE" = readme ] || [ "$MODE" = all ]; then
  mkdir -p "$(dirname "$OUT")"
  (cd "$REPO_ROOT/dashboard" &&
    DEMO_URL="http://127.0.0.1:$PORT" DEMO_OUT="$OUT" DEMO_FRAMES_DIR="$FIXTURE/frames" \
      ./node_modules/.bin/tsx scripts/record-readme-demo.ts)
  if [ ! -s "$OUT" ]; then
    echo "recording produced no GIF at $OUT" >&2
    exit 1
  fi
  echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
fi

if [ "$MODE" = walkthroughs ] || [ "$MODE" = all ]; then
  (cd "$REPO_ROOT/dashboard" &&
    DEMO_URL="http://127.0.0.1:$PORT" DEMO_OUT_DIR="$(dirname "$OUT")" DEMO_FRAMES_DIR="$FIXTURE/frames" \
      DEMO_ONLY="${DEMO_ONLY:-}" ./node_modules/.bin/tsx scripts/record-walkthroughs.ts)
fi

echo
echo "Key frames are in $FIXTURE/frames — review every one before publishing."
