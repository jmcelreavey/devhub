---
title: Database client parity audit
description: Point-in-time comparison of the /db workspace against desktop database clients, from when it first shipped (August 2026).
order: 7
icon: Archive
tags: [archive, database]
---

# Database client parity audit

What DevHub's `/db` workspace does vs what a full desktop database client (TablePlus,
DataGrip, Postico, Compass) does.

Method: every route under `dashboard/app/api/db/**` compared against the panels in
`dashboard/components/db/`, then against TablePlus's documented feature set. Written
2026-08-29, at the point the feature first shipped — so unlike the Git audit's first
revision, nothing here is arguing for work that was already finished.

**Short answer: the daily loop is covered, and two things TablePlus cannot do are the
actual point.** What is missing is mostly deliberate, and the one genuine gap is named
below rather than buried.

---

## Covered

### Connections

Plugins can discover connections and resolve credentials, including IAM authentication,
without making you maintain a separate connection list. Hand-added connections
(PostgreSQL, MongoDB, SQLite) sit alongside them, can be edited or removed, and SQLite
files already in your tracked repos can be discovered rather than typed.

Environment colour follows the connection, so prd reads as prd before you type. A
connection that cannot be opened still lists, with the reason attached — "your prd access
is not signed in" is more useful than a row that silently vanished.

### Browsing

Schema tree over tables, views and collections with estimated row counts. Row-windowed
result grid — a 50k-row result renders the same twenty rows a 20-row one does. NULL is
rendered distinctly from an empty string, which is the distinction you need at 2am.

### Query

CodeMirror 6 with dialect-aware highlighting, **schema-aware autocomplete** over your real
table and column names, multi-statement batches, and run-selection (`⌘↵` runs the
selection, or the whole buffer when there is none). Live classification as you type, so
Run is disabled — and says why — before you press it. Cancel is real: PostgreSQL via
`pg_cancel_backend` from a second connection, SQLite via SIGKILL on its runner process.

MongoDB accepts both `mongosh` shorthand (`db.posts.find({ … }).limit(10)`) and a JSON
command document. The shorthand is **parsed, never evaluated** — relaxed JSON (single
quotes, unquoted keys, `ObjectId(…)`) is rewritten, and anything unparseable is refused
rather than guessed at.

### Structure

Columns, indexes, constraints, and foreign keys in **both directions** — what this table
points at and what points at it. DDL composed from `pg_catalog`, read verbatim from
`sqlite_master`, and for MongoDB a field list inferred from a `$sample` with the sample
size stated, because presenting inference as schema would be a lie the user acts on.

### Safety

A statement classifier checks queries before execution. PostgreSQL also uses
`BEGIN READ ONLY`, and SQLite opens a read-only handle. MongoDB uses an operation
allowlist and rejects write stages; it has no engine-level read-only mode.
Writes against production require typing the connection's name. Row identity is resolved rather than guessed, and editing is disabled with a reason when no
identity exists.

### Also

Inline update/delete editing is staged locally, previews the generated parameterized SQL,
and applies as one transaction. Export to CSV / JSON / SQL inserts (with spreadsheet
formula injection defused), query history with kind and duration, per-connection preflight
that names the real cause of a failed connect, and in-flight queries surfaced in
`/api/status/exec` so the debug-hang ladder still works.

### Agents

Ten MCP tools at parity with the UI, writes included — `db_connections`, `db_preflight`,
`db_schema`, `db_table`, `db_query`, `db_explain`, `db_execute`, `db_cancel`,
`db_diff`, `db_history`. They share the UI's pool and access gate, so an agent cannot talk its way
past a read-only connection, and `db_explain` never becomes `EXPLAIN ANALYZE`.

---

## Gaps

Ordered by how often they'd actually bite.

### 1. No insert-row form — **the real editing gap**

Existing rows can be edited or deleted from the grid, staged, previewed and applied as one
transaction. `buildInsert()` and the rows API already support inserts, but the UI has no
"new row" form. Inserts therefore still go through the Query tab or `db_execute`.

That is a real completeness gap, but not a safety gap: no half-built insert interaction is
shown, and the existing write paths retain the same access and production gates.

### 2. Smaller, but noticeable

- **No streaming for very large exports.** Bounded by the row ceiling instead. The run
  existing run-registry + SSE pattern is the shape if it becomes a problem.
- **No saved-query library or multiple query tabs.** History recovers previous work, but it
  is not a replacement for naming a useful query and keeping several buffers open.
- **MongoDB cannot be cancelled or explained.** `maxTimeMS` bounds every operation server-side, but
  there is no out-of-band cancel comparable to `pg_cancel_backend`, so the tool reports
  `cancelled: false` rather than pretending. `db_explain` now refuses Mongo instead of
  claiming support it does not have.
- **No inbound foreign keys for SQLite.** Finding them means `PRAGMA foreign_key_list`
  over every table — cheap on a small database, wasteful on a large one.
- **No MySQL.** Another engine would need an adapter.
- **No ERD, no visual query builder, no data diffing.**

---

## Recommendation

Parity was never the target — TablePlus is right there, and it is a better *generic*
database client than this will ever be. What it cannot do is know which databases you have
access to, or let an agent query them through the same guarded path you do.

The remaining list, in order:

1. **Insert-row form**, reusing the transaction preview and confirmation flow.
2. **Saved queries and multiple buffers**, if `/db` becomes a daily workspace rather than
   an incident/debugging tool.
3. **Streamed export**, if a row-capped export ever becomes the limiting factor.
4. **MySQL**, if a supported workflow needs it.

ERD and visual query building stay out: a lot of surface for something the Query tab and a
`JOIN` already cover.

---

## One thing worth recording

The SQLite engine originally ran in a worker thread, which is the obvious choice and is
wrong. `node:sqlite` is synchronous and exposes no `interrupt()`, and `worker.terminate()`
cannot kill a thread parked in a synchronous C call — measured: it never resolved, and the
host process could not exit afterwards, `process.exit()` included. One runaway query would
have wedged the dashboard permanently.

A child process can be SIGKILLed, which is the same reasoning `exec-external.ts` already
records. If someone later "simplifies" this back to a worker thread to avoid the process
spawn, that is the bug they will reintroduce.
