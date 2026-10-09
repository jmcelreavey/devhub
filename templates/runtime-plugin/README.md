# Sample runtime plugin

Copy this directory into its own GitHub repository. Paste that repository's URL into Plugins → Add from GitHub, review the commit and permissions, then choose **Trust and enable**. Open its page from the plugin details. New DevHub-managed agent sessions receive its MCP endpoint.

`worker.mjs` is a portable, dependency-free prebuilt bundle. DevHub starts it with the bundled Node, writes a single JSON request to stdin and expects one JSON value on stdout. Pages return an HTML string, APIs return JSON, and MCP requests return a JSON-RPC response (or `null` for notifications). The process must exit within 30 seconds. Do not log to stdout.

The page runs in a sandboxed frame. It can call only declared plugin APIs by sending `{ type: "devhub:api", id, path, method, body? }` to its parent. Replies have `{ type: "devhub:result", id, result?, error? }`. Validate `event.source === parent`. Core APIs and Tauri commands are not exposed.

After changing the worker or dependency lockfile, update their SHA-256 values in `devhub-plugin.json`. Publish the bundle and lockfile in the repository; the first contract does not download release archives. Dependencies must be bundled ahead of time. Keep lifecycle scripts and native addons out of the runtime bundle.

Permissions are declarations, not a sandbox against hostile code. This example requests no environment variables or child processes. Server networking is not blocked by Node's filesystem permission model.
