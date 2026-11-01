---
title: Local cloud seams
description: The opt-in Postgres claim store and paired local-agent transport, checked locally.
tags: [architecture, storage, agents]
---

# Local cloud seams

Normal installs still use SQLite and in-process local operations. Nothing here deploys a
service, creates an account or adds a runtime. Hosted deployment and multi-user auth remain
future work.

## Storage

The domain interface is `RequestClaimStore` in `packages/shared/storage/request-claims.ts`:
read a submission hash, or atomically claim it for one run. Dispatch and editor selection
use it. The first claimant wins, including concurrent attempts and later retries.

This is deliberately smaller than full agent-run storage. Specs, status, events, admission
locks and exports still use the existing local stores. Making those synchronous callers
remote would need a separate change. SQLite's existing import, malformed-claim handling and
file rollback remain intact.

With no `DEVHUB_STORAGE_URL`, claims use the existing SQLite implementation. The existing
`DEVHUB_STORAGE_SQLITE=0` file rollback still works. Set `DEVHUB_STORAGE_URL` to a
`postgres://…` or `postgresql://…` connection string and set `DEVHUB_WORKSPACE_ID` to opt
into Postgres claims. The adapter uses the existing `pg` dependency and creates one table,
`devhub_request_claims`, keyed by workspace and request hash. Values are parameterised.
Connection and statement timeouts are five seconds; failures do not fall back to SQLite.
Restart core after changing either setting.

Use a fresh disposable workspace for this option. It does **not** migrate existing claims
between backends, and the SQLite export does not include Postgres claims. Switching an
existing workspace without migrating its claims could allow duplicate submissions.
Sharing claims between cores does not make their local runs or admission locks shared.

The same contract test runs against SQLite and, when `DEVHUB_STORAGE_URL` is set, Postgres:

```sh
cd apps/ui
npx vitest run ../core/src/domains/storage/request-claims.test.ts
```

The Postgres case is skipped without that variable. It creates random workspace records and
removes them afterwards. Use a disposable local database, not a production connection.

## Local agent

`LocalAgentHub` attaches an opt-in `/local-agent` WebSocket upgrade to core. A server-side
request context carries `workspaceId` and selects the connected agent for `localOps.run`
and `localOps.git`. HTTP callers cannot select a workspace through a header. Without that
context the same seam continues to run in-process.

For a local experiment, start the optional core entry point with isolated data directories:

```sh
mkdir -p /private/tmp/devhub-cloud-demo/{home,data,notes,workspace}
env HOME=/private/tmp/devhub-cloud-demo/home \
  DEVHUB_APP_DATA=/private/tmp/devhub-cloud-demo/data \
  NOTES_DIR=/private/tmp/devhub-cloud-demo/notes \
  REPO_ROOT=/private/tmp/devhub-cloud-demo/workspace \
  npx tsx --tsconfig apps/core/tsconfig.json apps/core/src/scripts/local-agent-core.ts \
  --port 43460 --workspace demo --pair-file /private/tmp/demo-pair.json
```

That entry point serves core HTTP routes on loopback; it doesn't start the dashboard,
terminal, scheduled jobs or the normal startup integrations. Existing HTTP auth still
applies. Embedders can pass `{ localAgent: { hub, workspaceId } }` to `createCoreServer`.

Pairing creates a random 256-bit secret in the new file with mode `0600`; it is never
printed. Transfer the file privately to the agent machine, then connect:

```sh
npx tsx --tsconfig apps/core/tsconfig.json apps/core/src/scripts/local-agent.ts \
  --connect wss://core.example/local-agent \
  --pair-file /private/tmp/demo-pair.json --root /path/to/workspace
```

`wss` requires an operator-provided TLS endpoint; this change does not provide or deploy
one. Local tests use `ws://127.0.0.1:43460/local-agent`. Other plaintext hosts, redirects,
URL credentials and browser Origin headers are rejected. Pairing expires after five minutes
and is consumed by one connection. Remove the copied pairing file after connection. A
disconnect needs a new pairing; the example core entry point generates one on restart and
removes its file on normal shutdown. If it crashes, remove the stale file before restarting.

The paired core can run commands as the agent's OS user. Pair only a core you trust.
Workspace IDs bind requests to that pairing; they are not user authentication or an OS
sandbox. The agent resolves `cwd` beneath its configured root (relative paths travel best
between machines), but a trusted command can still access files outside it.

The transport supports bounded text commands: at most 16 in flight, 64 KiB per request and
per output stream, and a 120-second command timeout. It rejects environment forwarding,
stdin, binary results, callbacks and interactive/synchronous process handles. These limits
mean the whole application is not yet remotely operable. Errors are deliberately generic
so command arguments and credentials do not leak. Disconnect aborts agent commands and
rejects pending core calls; commands with an unknown outcome are never replayed.

`apps/core/src/lib/local-agent.test.ts` checks rejected authentication, a real subprocess
round trip with workspace context, local default behaviour and disconnect handling on
loopback. No public deployment or external account is part of this proof.
