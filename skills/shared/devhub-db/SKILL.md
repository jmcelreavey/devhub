---
name: devhub-db
description: Use DevHub's guarded PostgreSQL, MongoDB, or SQLite client for database work.
metadata:
  short-description: Query and mutate databases safely through DevHub
---

# DevHub database client

The `db_*` MCP tools proxy the local dashboard, which owns credentials, connection pools, timeouts, write guards, and history. Use them before shell clients.

## Workflow

1. If the exact connection ID is known, call `db_connections({ connectionId })`; otherwise filter by environment, engine, or service.
2. For BI RDS access questions, call `bi_db_access_check` before broader IAM or connection discovery.
3. Make an unavailable connection ready with `db_connect`:
   - reads: `accessMode:"read"`
   - explicitly requested writes: `accessMode:"write", fix:true`
4. Inspect only what is needed:
   - `db_schema` defaults to compact, non-system objects
   - `db_table` defaults to a summary without duplicate DDL
   - request JSON/full detail explicitly when required
5. Use `db_query` for reads. Its server-enforced read intent cannot mutate even through a write-capable connection.
6. Use `db_execute(confirm:true)` only for an explicitly authorized mutation. Production also requires the exact `confirmLabel` returned by `db_connections`.
7. Verify writes with a focused read.

Compact output is the default and MCP reads default to 100 rows. Increase `rowLimit` or request JSON only when the task needs it.

## Safety and failure handling

- Never interpolate untrusted values into SQL; parameterize through an application/script when values are not fixed operator input.
- Do not echo credentials or connection strings.
- Use `db_preflight` to diagnose without changing machine state; `db_connect(fix:true)` may switch AWS profile or start Tailscale.
- Use `db_cancel` for an over-running operation and `db_explain` before tuning SQL.
- A read-only refusal is an access decision, not a transient failure.
- If dashboard routes return 404, the packaged DevHub runtime is older than the checkout; rebuild/sync it instead of retrying the same call.

## BI service ownership shortcuts

- Saved articles/bookmarks: Idun `Articles`; clearing a bookmark follows service behavior by setting `status = 'inactive'`, not deleting the row.
- User identity by email: the identity service's `Users` table.
- Subscriptions and access belong to the entitlements service, not alongside saved articles.

Resolve other ownership from service documentation or code before exploring schemas at random.
