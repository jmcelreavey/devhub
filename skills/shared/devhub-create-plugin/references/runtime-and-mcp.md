# Runtime and MCP

Read this when adding a packaged runtime or a plugin-owned MCP server. Resolve the paths below against the current DevHub checkout; inspect the shipped contract instead of copying an old schema.

## Portable runtime

Start with `templates/runtime-plugin/worker.mjs`, its manifest and lockfile. Replace the sample operation with the requested domain workflow. A TypeScript source package may build to a single `.mjs`; keep source and a reproducible build command alongside the committed bundle.

The current request-worker contract:

- `runtime.api: "1"`, `transport: "request-worker"`.
- Relative entry and lockfile paths with SHA-256 digests. No traversal or symlinks.
- Explicit `pages`, method/path `routes`, named `mcp` endpoints and `permissions`.
- Dependencies bundled before installation. The GitHub installer does not run a build or install runtime dependencies.
- One JSON request on stdin: `{ kind: "page" | "api" | "mcp", path, method, body? }`.
- One JSON-encoded response on stdout: an HTML string, API result, or JSON-RPC response. Diagnostics go to stderr.
- A fresh process per request. Persist necessary state in the supplied plugin data directory, not in process memory or the reviewed bundle.
- A default 30-second deadline, 64 KiB request and 2 MiB response limit. Check current host constants before implementing large payloads.

Read `runtime-contract.ts` and `runtime-host.ts` for the current streaming format and route deadlines. Declared streaming API routes can have bounded output and longer deadlines; they do not imply a persistent daemon, SSE service or WebSocket server.

Declare only the environment variables, network destinations, host paths and commands the workflow needs. The worker's HOME is its own data directory; do not assume it is the user's normal home. Consult the current host contract when authorised host-home reads are required. Network declarations disclose access; they are not network enforcement. Keep the limits of the host's protection accurate in the README.

## Embedded page

The host renders returned HTML in a sandboxed frame. Use its message bridge for declared plugin APIs:

```js
parent.postMessage({
  type: "devhub:api",
  id: requestId,
  path: "/status",
  method: "GET",
}, "*");
```

The opaque frame origin requires the bridge's wildcard target; validate incoming `event.source === parent`, message type, request id and result shape. Match each response to its request and handle rejection and timeout visibly. Never expose credentials in HTML or messages. Core APIs and desktop commands are not available through this bridge.

Inspect `apps/ui/app/plugins/runtime/[name]/runtime-page.tsx` for current response and streaming events. Do not invent theme events or parent APIs. Bundle styles and assets using mechanisms the host actually serves; relative files next to the worker are not automatically public URLs.

## MCP transport and tools

For packaged plugins, declare each stateless HTTP MCP server in `runtime.mcp` and handle `kind: "mcp"` requests in the worker. Follow the starter's lifecycle, including initialise, notifications, ping, tools/list and tools/call. Return JSON-RPC errors for unsupported methods and protocol errors, and tool error results for failed domain operations. Validate the protocol version and all arguments using the supported SDK or current contract.

For checkout clients that need stdio, put the self-contained server package in `mcp-servers/<slug>-server/` and the active catalogue JSON in `mcp/<slug>.json`. Declare `contributes.mcp`. Use `PLUGIN_ROOT` in commands and paths, never the author's absolute home path. Send only protocol traffic to stdout. Keep dashboard URL discovery and authentication consistent with current DevHub helpers if the server proxies the dashboard.

Keep domain behaviour shared between transports. Do not duplicate AWS/API/database operations in a second MCP implementation. Declare accurate input schemas, descriptions and read-only/destructive annotations; annotations are hints, not enforcement. A tool's output should identify the target, result and actionable failure, without leaking credentials.

Verify MCP with an actual client or protocol harness:

1. Initialise, list tools and call a real read operation.
2. Exercise invalid arguments, unknown tools and upstream failure.
3. Verify secrets stay out of returned data and logs.
4. For state changes, test validation, authorisation and retry behaviour on a safe target.
5. Confirm a fresh configured client session discovers the installed server. An entry in a manifest alone proves nothing about connectivity.

## Reviewed actions, when needed

Use the current `docs/guides/plugin-actions.md` and host tools for the review/run/status lifecycle. Resolve policy from the live tool contract and the user's existing authorisation; older documentation may describe a different confirmation UI.

The plugin owns action validation, a concrete target and warning, an expiring single-use token bound to the validated operation, atomic consumption and execution-time rechecks. Store tokens and run state outside the immutable bundle. Expose status so an uncertain result can be reconciled. A timeout or cancellation does not prove an external operation was undone; inspect the run and destination before considering a retry.

## Package proof

Rebuild after source changes and recompute every declared digest from the shipped bytes, including logo and font assets. Validate with the host's `readManifest` and `verifyRuntimeFiles` helpers, then inspect the complete plugin using `inspectPluginDir`. Inspect their signatures and result types first; surface all blocking issues rather than treating a parseable JSON file as valid.

Test the built bundle from a clean temporary directory with only the declared environment. Exercise one page, API and MCP tool, plus malformed requests and declared permission limits. Then verify the install through the real host. New DevHub-managed sessions receive runtime MCP endpoints; already-running sessions need refreshing or restarting.

Updates to reviewed runtime code or permissions require a fresh host review. Follow the current installer flow rather than modifying an installed receipt or accepted bundle in place.
