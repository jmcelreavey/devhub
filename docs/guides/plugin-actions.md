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

A portable plugin can add action routes without rebuilding DevHub. The core hosts the reviewed bundle; the plugin owns what an action means and how it is approved. Company-specific code, credentials and runbooks belong in that separate plugin, not in the public dashboard.

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

## Output and uncertain outcomes

For a streaming route, the worker uses the versioned `emit` callback to produce bounded `{ "type": "output", "text": "Checking…" }` events; the host adds the final `result` or `error` record. The in-app page can follow output as it arrives. MCP returns the output and receipt after completion, not live events.

Per-route deadlines are between 30 and 900 seconds. Review tokens, run state and cancellation belong to the plugin's data directory. Disabling a runtime cancels active workers and blocks new requests. Cancellation does not prove that an external action was undone. After a timeout, disconnect or missing receipt, check recorded runs and the actual destination before considering another review. Never automatically retry an execution token.

See [Plugin system](../architecture/plugins.md) for permissions, request/response limits and the trust boundary. Runtime permissions are not a sandbox against hostile code.
