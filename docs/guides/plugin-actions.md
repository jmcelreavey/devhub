---
title: Plugin actions
description: Add reviewed actions, bounded output and status reads through the generic request-worker API.
order: 25
icon: Plug
tags: [plugins, integrations]
related:
  - architecture/plugins
  - architecture/mcp-server
  - guides/integrations
---

# Plugin actions

A portable plugin can add action routes without rebuilding DevHub. The core hosts the reviewed bundle; the plugin owns what an action means and can request a host approval. Company-specific code, credentials and runbooks belong in that separate plugin, not in the public dashboard.

## Example: team-tools

Start with the [portable example](../../templates/runtime-plugin/README.md). Declare only the routes the plugin needs in its manifest:

```json
[
  { "path": "/actions", "method": "GET" },
  { "path": "/actions/review", "method": "POST" },
  { "path": "/actions/execute", "method": "POST", "stream": true, "timeoutSeconds": 300 },
  { "path": "/runs", "method": "GET" },
  { "path": "/runs/status", "method": "POST" }
]
```

For example, review `{ "action": "validate", "workspace": "sample-project" }`. The plugin must validate that workspace against its own allowlist, show the exact destination and warning, and store a short-lived single-use token bound to the action and current code. Execution consumes that token atomically and rechecks the action. A label such as *dry-run* is not read-only enforcement.

## MCP contract

- `plugins_action_list`: `plugin` and `kind` (`actions` or `runs`).
- `plugins_action_review`: `plugin` and plugin-defined `input` (at most 32 KiB).
- `plugins_action_run`: `plugin`, reviewed UUID `token` and `confirm: true`, only after the human approves the exact action and warning.
- `plugins_action_status`: `plugin` and recorded UUID `runId`.

The plugin name is a slug, not a filesystem path. Calls use `/api/plugins/runtime/<plugin>`; the host requires local plugin-management access, verifies the enabled bundle's reviewed hashes and refuses undeclared routes. There is no source-route or arbitrary shell fallback. Extra release, environment or account policies must be enforced inside the plugin, not assumed from the core.

## Host approval

Declare each entry point that can request approval in `runtime.capabilities.approvals`, for example `[{ "path": "/actions/review", "method": "POST" }]` or `[{ "server": "tools", "tool": "review_action" }]`. The route or MCP server must also be declared normally. The grant is shown during plugin review.

For a declared API route, return `{ "ok": true, "hostApproval": { "id": "publish", "summary": "Publish the report", "payload": { "destination": "example" } } }`. The payload is JSON, limited to 16 KiB; the action ID and summary are limited to 200 and 500 characters. The host rejects declared credentials in these fields. It queues the exact ID, summary and payload in the existing dock approval UI and returns `hostApproval: { proposalId, status: "pending" }` in place of the request. Other response fields are preserved.

For a declared MCP tool, return a successful JSON-RPC response with the same `hostApproval` field alongside `result`. Its single text content item must contain `__DEVHUB_APPROVAL_ID__` exactly once; the host replaces that marker with the proposal ID and removes `hostApproval` from the JSON-RPC response. The caller can use `terminal_proposal_status` to check the decision.

To deliver a decision to the worker, call the **same** API route with `body.hostApprovalId` or the same MCP tool with `params.arguments.hostApprovalId` set to the proposal ID. The host adds `hostApproval: { proposalId, id, summary, payload, status }` to the worker's top-level request. Only this host-supplied value is authoritative; caller-provided body fields are not proof of approval. `pending` can be polled, while `approved`, `denied` and `expired` are delivered at most once to the same reviewed plugin revision and entry point. The plugin must check the status and use the host-supplied payload before acting. A decision is consumed before the worker starts: after a failed or interrupted call, check the destination before requesting a new approval. Proposals expire after 15 minutes and live in the dashboard process, so a restart loses them.

An HTTP alias forwards the original JSON in `body.body`. The worker returns `{ status, body, hostApproval }` for an approval request; the host puts its receipt in the returned JSON body. Repeat the request with `hostApprovalId` in the original JSON body to deliver a decision to the same reviewed route.

An agent run can also be declared for a non-streaming POST route using `{ path, method: "POST", label, action, prompt, inputKeys, titleKey }` in `runtime.capabilities.agentRuns`. Return `{ status: 200, body: { ok: true }, hostAgentRun: true }` after validating the request and any required approval. The host starts the reviewed prompt in its notes directory and returns the run ID and provider label in the HTTP body. The worker cannot supply the prompt or working directory at invocation time.

For a reviewed HTTP preparation, return `{ status: 200, body: { ok: true, prompt, title }, hostAgentPrepare: true }` when the caller supplies `prepare: true`. The host checks the same agent grant and adds its notes directory as `cwd`; it does not start an agent.

An approved POST or MCP tool may declare `backgroundRuns` with its entry point and a streaming POST `runRoute`. After the approved worker returns `hostBackgroundRun: true`, the host generates a run ID and starts the reviewed route with the original request and the host decision. The route must emit `__DEVHUB_RUN_READY__` as its first output after its status is readable. The host returns the run ID once ready; a disconnect after that does not cancel the background worker. Disabling the plugin still stops its workers. The plugin owns status, retained output and any remote cancellation; check status before retrying an uncertain start.

A streaming GET alias declares `preflight` as a non-streaming GET route. The host forwards the same query and path parameters to it, then translates output records to SSE `data` lines and the final `{ status: 200, body: { exitCode } }` to a `done` event. Closing the SSE connection stops the stream worker, not the underlying run.

## Output and uncertain outcomes

For a route declared with `stream: true`, the worker writes newline-delimited JSON records to stdout: `{ "type": "output", "text": "Checking…" }` for output and `{ "type": "progress", "text": "Checking", "current": 1, "total": 3 }` for progress. Progress counts are optional non-negative finite numbers; `total`, when supplied, must be positive and at least `current`. Text is limited to 16,384 characters per record. The worker ends with `{ "type": "result", "result": ... }`; the host forwards progress as it arrives and sends the final `result` or an `error` record. The existing 2 MiB worker output limit still applies.

A sandboxed plugin page receives `devhub:output` and `devhub:progress` messages with the original request `id`, followed by `devhub:result`. Check `event.source === parent`. MCP action tools return the collected output and receipt after completion; they do not stream live.

Per-route deadlines are between 30 and 900 seconds. Review tokens, run state and cancellation belong to the plugin's data directory. Disabling a runtime cancels active workers and blocks new requests. Cancellation does not prove that an external action was undone. After a timeout, disconnect or missing receipt, check recorded runs and the actual destination before considering another review. Never automatically retry an execution token.

See [Plugin system](../architecture/plugins.md) for permissions, request/response limits and the trust boundary. Runtime permissions are not a sandbox against hostile code.

## Background service task handoffs

Declare each operation in `runtime.capabilities.service.tasks` and grant loopback network access. The host supplies `DEVHUB_RUNTIME_SERVICE_TASKS` with a port and token. Send one newline-terminated JSON `{ token, request }` per connection; the response is `{ ok: true, result }` or `{ ok: false }`. Shared request and response types are exported from `packages/shared/plugin-runtime.ts`. Use a deadline long enough for Git network operations, and close the socket to cancel further host work. Consent and the active profile are checked again before writes.

`git-repos` lists local repository origins; `git-pickup` fetches a branch into a managed worktree. `pickup-create`, `pickup-hold`, `pickup-note`, `pickup-finish` and `pickup-retire` manage the corresponding task. Keep the returned task's `createdAt`, checkout and handoff ID for subsequent calls. A pickup remains read-only until finished. `jira-connected` reports whether the default connection is configured; `jira-assign-self` is limited to the pending pickup's Jira key.

For outgoing work, `git-inspect` returns the checkout, changed files and a review token tied to that task and worker. Show the changes and obtain confirmation before creating the pending task handoff and calling `git-push`. The token expires after 15 minutes or a service restart. Push rechecks the checkout, stages and commits WIP only when requested, and never force-pushes. `handoff-note-read` returns a section revision; pass it to `handoff-note` to replace only that unchanged section. `answer-repo` takes the unchanged question, task creation identity, checkout and a stable request ID, then links the recognised repository and resumes the task.

Git, Jira and agent dispatch can finish after a disconnect. Check the checkout, remote and Jira before retrying an uncertain result. A review token can be retried after a completed WIP commit if the push did not finish and the service remains running. A successful push consumes it; a failed staging or commit may require a fresh review after the handoff is released.
