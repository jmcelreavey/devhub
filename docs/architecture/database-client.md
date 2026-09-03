---
title: Database client
description: "How /db reaches PostgreSQL, MongoDB and SQLite — connection providers, the read-only guarantee, and why SQLite runs in a child process."
order: 7
icon: Database
tags: [architecture, database]
related:
  - architecture/plugins
  - reference/ui-vocabulary
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
