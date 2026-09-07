---
title: Database client
description: "How /db reaches PostgreSQL, MongoDB and SQLite — connection providers, the read-only guarantee, and why SQLite runs in a child process."
order: 7
icon: Database
tags: [architecture, database]
related:
  - architecture/plugins
  - architecture/mcp-server
  - reference/api-routes
---

# Database client

`/db` is a database workspace in the same sense `/repos` is a Git workspace: browse,
query, inspect structure, edit rows. It covers the three engines BI runs — PostgreSQL
(RDS), MongoDB (Atlas) and SQLite — and it exists because the alternative was a
credential-vending page (`/ops`) that hands you a `psql` command to paste somewhere else.

Two things make it worth building rather than installing TablePlus:

1. **Connections are derived from your access, not from a config file you maintain.**
   The BI plugin already knows which database services your team can reach and with which
   usernames. `/db` turns that into a list you click.
2. **Agents use the same path.** The MCP tools go through the same pool, the same
   classifier and the same access gate the UI does, so there is one place where "may this
   run?" is decided.

---

## Layers

Mirrors the Git client, because the shape is proven:

```
pool + query registry     lib/db/pool.ts, query-registry.ts   timeouts, cancellation, tracking
engine adapters           lib/db/{postgres,mongo,sqlite}/     connect, introspect, run
pure parsers/validators    lib/db/statement-kind.ts, identity.ts, export.ts
API routes                app/api/db/**                       auth, status codes, error prose
consumers                 MCP tools  |  components/db/**       both go through the routes
```

**The MCP server never opens a database connection.** It proxies `/api/db/*`, so the
dashboard process stays the only owner of pools and credentials — the same rule the Git
tools follow.

---

## Connections come from providers

A provider answers two questions, deliberately separated by cost:

- `list()` — what could I connect to? Cheap by contract: no network, no credential fetch.
  The rail refetches this, so a provider that shells out to `aws` here would make the
  whole page as slow as the slowest credential mint.
- `resolve(id)` — how do I connect to this one? Allowed to take seconds, because it mints
  an RDS IAM token or reads STS credentials.

`DbConnectionRef` (from `list()`) is safe to send to the browser.
`ResolvedDbConnection` (from `resolve()`) never is — it holds the password, and it stays
in the pool.

### The plugin seam

This is the **first runtime extension point** in the plugin system;
`TEMPLATE_AND_PLUGIN_PLAN.md` costed one previously and shipped a thin core detector
instead. It follows the existing codegen precedent rather than inventing a mechanism:

- a plugin declares `dashboard.connections` in `devhub-plugin.json`, pointing at a module
  under its `lib/` that default-exports a `DbConnectionProvider`;
- `lib/plugins/db-materialize.ts` emits `lib/plugin-db-providers.generated.ts` with a real
  `import` — the same empty-baseline + `skip-worktree` treatment as
  `plugin-nav.generated.ts`, so core builds with no plugin installed;
- the materialiser refuses a module that `dashboard.paths` would never copy, because the
  generated import would otherwise fail the *whole build* rather than one page.

`devhub-bi` uses this to expose every RDS service your team has IAM for, plus both Atlas
clusters, per environment.

---

## Read-only is enforced twice

This is the part to not weaken.

**`lib/db/statement-kind.ts`** classifies each statement as `read | write | ddl | unknown`.
It tokenises rather than pattern-matching a prefix, because the interesting cases hide:

- `WITH d AS (DELETE … RETURNING *) SELECT * FROM d` is a write,
- `EXPLAIN ANALYZE DELETE …` really deletes,
- `SELECT … INTO` creates a table, `SELECT … FOR UPDATE` takes locks,
- a column named `"delete"` is not the keyword.

`unknown` fails closed. This layer produces the *error message*; treat a bug in it as a UX
bug, never as a breach.

**The engine is the guarantee:**

| Engine | Mechanism |
|---|---|
| PostgreSQL | reads run inside `BEGIN READ ONLY`, with `SET LOCAL statement_timeout` |
| MongoDB | an operation **allowlist** — there is no generic `runCommand`, and `$out`/`$merge` are rejected even nested inside `$facet` |
| SQLite | the handle is opened `readOnly: true` |

The classifier can be wrong and the data is still safe. Never let an adapter skip its own
transaction mode because the classifier said "read".

Writes against a connection flagged `dangerous` (prd + a privileged profile) additionally
require the user to type the connection's label — the same shape as the `confirmDangerous`
gate on the AWS profile switch, and for the same reason.

---

## Why SQLite runs in a child process

`node:sqlite` is synchronous. A slow statement on the main thread does not make one route
slow — it stops the event loop, which is the failure `exec-external.ts` exists to prevent.

A worker thread is the obvious fix and it is the **wrong** one. `node:sqlite` exposes no
`interrupt()`, and `worker.terminate()` cannot kill a thread parked in a synchronous C
call: V8 terminates at JS safepoints and a recursive-CTE scan reaches none.

Measured, not assumed. `terminate()` on a thread running

```sql
WITH RECURSIVE spin(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM spin) SELECT count(*) FROM spin
```

never resolved, and the host process could not exit afterwards — `process.exit()` included.
One such query would have wedged the dashboard permanently.

A child process has an answer a thread does not: **SIGKILL**. Verified end to end — that
same query is killed on timeout in ~0.4s, the dashboard stays responsive throughout, and
the pool reopens the connection on the next query.

The runner source is a string passed to `node -e` rather than a file, because Next's file
tracing does not follow a path handed to `spawn` at runtime — a script path would work in
dev and break in the packaged app. The trade is that the runner body is not typechecked,
so `lib/db/sqlite/adapter.test.ts` exercises it against a real database file.

---

## Diagnostics

Every query is tracked. `GET /api/status/exec` returns `dbQueries` (in-flight),
`dbSlowest` and `dbConnections` alongside the external-command lists, so the
`devhub-debug-hang` ladder's first rung covers database work too.

`lib/db/query-registry.ts` keeps its state on `globalThis`, unlike `exec-registry.ts`.
That is not stylistic: the writer is `/api/db/[id]/query` and the reader is
`/api/status/exec`, and Next bundles route handlers into separate module graphs — module
state is a *different* object on each side. With the registry in module scope, one
`/api/status/exec` call during a running query returned the pooled connection with
`busy: 1` and an empty `dbQueries` in the same response. A diagnostic that reports
"nothing running" while something is running is worse than none.

---

## Timeouts

Chosen by operation class, never by the caller — the same rule `repo-local.ts` uses:

| Tier | Ceiling |
|---|---|
| Metadata / catalogue | 15s |
| Interactive query | 60s (raisable to 300s per run) |
| Export / streamed run | 600s |
| Connect | 10s |

Credentials carry `expiresAt`. RDS IAM tokens last 15 minutes and Atlas rides STS session
credentials; both engines authenticate at connect time only, so an open socket outlives its
password. The pool re-resolves before opening a *new* connection rather than tearing down
a working session on a timer.

---

## Row identity

Inline editing needs a WHERE clause that matches exactly the row the user edited.
Resolution order: primary key → usable unique index → `ctid` / `rowid` / `_id`.

A unique index over a nullable column is **not** usable — `NULL != NULL`, so the update
would silently match nothing and report success. Views are refused outright. When no
identity exists, editing is disabled **with a reason shown**, never approximated.

---

## Where things live

| Concern | File |
|---|---|
| Types shared with the client | `lib/db/types.ts`, `lib/db/introspect-types.ts` |
| Provider contract | `lib/db/provider.ts`, `lib/db/registry.ts` |
| Connection lifecycle | `lib/db/pool.ts`, `lib/db/timeouts.ts` |
| The access gate | `lib/db/execute.ts` |
| Engines | `lib/db/{postgres,mongo,sqlite}/` |
| Routes | `app/api/db/**` (all authenticated, GET included) |
| UI | `app/db/`, `components/db/` |
| MCP tools | `mcp-servers/devhub-server/src/tools/db.ts` |
| BI provider | `devhub-bi/dashboard/lib/bi-db-provider.ts` |

Unlike `/api/repos/*`, **every `/api/db` route calls `requireDashboardAuth`**. Git routes
carry local diffs; these carry rows out of production.

---

## Using `/db`

**Databases** is a Library sidebar item (`/db`), desktop-only and **ungated**. SQLite
files need no integration, so gating on BI or GitHub would hide the one path that works
on a fresh machine. BI connections simply do not appear unless the plugin is installed.

| Surface | What it does |
| --- | --- |
| Connection rail | Lists every connection this machine could open. Cheap: providers must not network in `list()`. |
| Query tab | SQL (Postgres/SQLite) or Mongo shell/JSON. Run classifies first (`planOnly`) so **Run** can disable itself before you press it. |
| Structure | Schema tree + one table's columns, indexes, FKs, and whether rows are editable. |
| Grid edits | Staged INSERT/UPDATE/DELETE built **on the server** from re-derived row identity — the client never posts SQL to the edit route. Mongo document editing from the grid is not supported; use `updateOne` on Query. |
| History | Last 500 statements, newest first (`<app-data>/db-history.json`). Summarised in the list; full text when you open one. |
| Schema diff | Compare two connections of the same engine (`POST /api/db/diff`). Object-level always; column-level deep pass capped at 40 tables. |
| Export | `csv` / `json` / `sql` of a **read**. CSV cells that look like spreadsheet formulas (`=`, `+`, `-`, `@`) are tab-prefixed. |
| AI SQL | `generate` / `fix` / `explain` / `optimise`. Nothing is executed — the statement returns to the editor and faces the same classifier. Needs `AI_API_KEY`. |

### Hand-added connections

The core provider (`local:…`) works with no plugin. Add Postgres (host required), MongoDB
(URI required), or SQLite (file required) from the rail. Defaults to **read-only** when
`readOnly` is omitted — a hand-added connection has no AWS profile to derive access from.

Storage is `<app-data>/db-connections.json` (checkout root under `npm run dev`; OS app
data when packaged), mode `0600`. Passwords stay on disk in plaintext, same as
`.env.local`. They are never sent to the browser (`hasPassword` only).

`GET /api/db/discover` walks the Repos scan directory (depth 5, skips `node_modules` / `.git` / build dirs) for `.db`, `.sqlite`, `.sqlite3`, and `.db3` files so **Add connection** can offer them. That walk is *not* on the rail's load path.

### Constraints

| Constraint | Value |
| --- | --- |
| Statement length | 200 000 characters |
| Interactive timeout | 60s, raisable to 300s per run |
| Row ceiling | 50 000 (`DB_MAX_ROW_LIMIT`) |
| MCP `db_query` default rows | 100 |
| History cap | 500 entries |
| Schema-diff deep tables | 40 |

Machine-readable refusal codes: `read_only`, `read_required`, `confirm_required`,
`unavailable`, `not_found`, `timeout`, `no_row_identity`. A 403 means the request was
understood and refused; a 400 is a bad payload.

---

## MCP tools

All `db_*` tools proxy `/api/db/*`. The MCP process never opens a socket or holds a
password. Mutating tools take `confirm: true` (same convention as `repos_git_commit`).
A write against a `dangerous` connection also needs `confirmLabel` equal to the
connection's exact label from `db_connections`.

| Tool | Role |
| --- | --- |
| `db_connections` | List (filter by id / env / engine / service). `refresh` busts the 30s cache. |
| `db_preflight` | Readiness checks only — does not change machine state. |
| `db_connect` | Preflight, then optionally apply remedies (`fix: true`: AWS profile switch, Tailscale). |
| `db_schema` | Namespaces and objects. |
| `db_table` | One table/collection plus editability. |
| `db_query` | Reads only (`readOnly: true` on the HTTP body). Refuses anything else. |
| `db_explain` | Postgres/SQLite `EXPLAIN` (never `ANALYZE`). One statement. Mongo not exposed. |
| `db_execute` | Writes/DDL. `confirm: true`. Use `db_connect` with `accessMode: "write"` first when BI needs elevating. |
| `db_cancel` | Stop in-flight work. `cancelled: false` is a real answer (Mongo has no out-of-band cancel). |
| `db_diff` | Schema compare. |
| `db_history` | Recent statements. |

`db_explain` strips any existing `EXPLAIN`/`ANALYZE` prefix and replaces it with a plain
`EXPLAIN`, and it refuses batches — otherwise `SELECT 1; DELETE …` would explain the
SELECT and run the DELETE. Prefer these tools over a shell client; the dashboard owns
timeouts, pools, and the write gate. See `skills/shared/devhub-db/SKILL.md`.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Rail empty except local SQLite | BI plugin not installed, or `list()` failed (errors come back in `errors[]`, not as a 500). |
| Connection dimmed / `unavailable` | Run `db_preflight` or click the rail's remedy. Usually expired AWS creds or Tailscale down. |
| "Your AWS credentials have expired" | Sign in again from Ops, then reopen. `POST /api/db/connections` drops the pool after a profile switch. |
| Connect timeout / host did not resolve | Private RDS/Atlas hosts need the tailnet (and Atlas PrivateLink names need Tailscale DNS). |
| `403` `read_only` | Connection access mode is read. For BI, switch to a writer profile; for local, edit the saved connection. |
| `403` `confirm_required` | Type the connection label (prd + privileged). Agents pass `confirmLabel`. |
| Grid **Edit** disabled | No usable row identity (no PK, unique-nullable index, or view) — the reason is shown — or the connection is read-only. |
| AI SQL `503` | No provider (`AI_API_KEY` / Setup → AI Provider). |
| MCP `db_*` 404 | Packaged runtime older than the checkout; rebuild/sync rather than retrying. |

In-flight queries show up on `GET /api/status/exec` as `dbQueries` / `dbSlowest` /
`dbConnections`. Cancel from the UI or `db_cancel`.
