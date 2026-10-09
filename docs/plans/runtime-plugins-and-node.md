---
title: Runtime plugins and managed Node
description: Runtime plugin delivery in the packaged app, with an app-owned Node and npm toolchain for Agents.
order: 4
icon: Blocks
tags: [plans, plugins, desktop, paseo]
---

# Runtime plugins and managed Node

9 October 2026. Implementation plan. The compatibility boundary is deliberate: existing checkout plugins keep working, but they need a portable runtime bundle before the packaged app can execute them.

## Architecture

### Runtime plugins

| Option | Decision | Reason |
| --- | --- | --- |
| Copy Next.js pages into standalone | Reject | Route discovery and compilation happen during the build. Copying source does not register routes. |
| Module federation or arbitrary ESM in the dashboard | Reject | Couples React and Next versions and gives plugin code the dashboard's process and secrets. |
| Build inside the installed app | Fallback for developers only | Needs a compiler, dependency downloads and potentially native toolchains. Slow, difficult to reproduce and unsuitable for first run. |
| Prebuilt separate HTTP server | Follow-up for streaming and large applications | Viable, but needs process supervision, port authentication, restart reconciliation and platform smoke tests. |
| **Prebuilt portable Node request worker** | **Initial implementation** | Uses the bundled Node, a fixed host route and bounded subprocesses. No compiler, ports, npm install or dashboard rebuild. |

Next's [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) includes traced build output. It is not an extension loader. A fixed dynamic host route must therefore ship in core once; future plugin installs use it without rebuilding.

Add an optional `runtime` object, versioned independently as `runtime.api: "1"`, to the existing `devhubApi: "1"` manifest. It declares a repo-relative prebuilt JavaScript entry, SHA-256, a dependency lockfile and its SHA-256, pages, API routes, MCP servers and capabilities. The first transport is `request-worker`: one JSON request on stdin, one JSON response on stdout, then exit. Use `execExternal`, a 30-second deadline, bounded input/output and cancellation. A plugin may bundle its own libraries, but must not import core's internal modules. Native modules and runtime package installation are not supported by this transport.

The existing GitHub installer supplies the immutable commit snapshot and the preview digest. It downloads without running repository scripts. Runtime bundles are checked before consent and before execution. Only managed installs with matching approval receipts may run; a checkout registry entry cannot silently become executable through the new host. Save the accepted manifest, source tree and permission identity in the receipt outside the plugin directory. No automatic update or `git pull` for runtime installs.

Pages open in the DevHub shell under `/plugins/runtime/<name>`. Render HTML in a sandboxed iframe without `allow-same-origin`. The only host bridge forwards explicitly declared API requests for that plugin. Never forward dashboard cookies, authentication headers, arbitrary URLs or Tauri capabilities. Server routes live under `/api/plugins/runtime/<name>/...`. MCP uses a separate stateless JSON endpoint managed by DevHub, with the same bounded worker transport. Long-lived stdio sessions, SSE, WebSockets and background jobs need the later supervised-server transport.

Branding uses validated colour tokens, preset metadata and local image/font assets. Do not inject arbitrary plugin CSS into the shell. Runtime desktop app icons are excluded because signed application resources are immutable. Disable removes the runtime brand contribution; it must not rewrite personal preferences.

`requires.dashboardPackages` remains a checkout requirement. Runtime publishers bundle these dependencies and record their resolved graph in a lockfile. DevHub does not install them into the packaged dashboard. `requires.commands` is checked without executing manifest commands; missing commands block activation and show an inert install hint. No automatic shell commands from a manifest.

### Node and npm

The desktop runtime already pins Node 22.22.3 and per-platform archive SHA-256 values in `desktop/node-runtime.json`. macOS currently stages the binary but drops npm. Linux/WSL already stages npm for rebuilds. Reuse that distribution on macOS arm64/x64 and Linux arm64/x64. Windows runs the toolchain inside the selected WSL2 distro, never using Windows Node against Linux packages.

| Option | Decision | Reason |
| --- | --- | --- |
| Require system Node | Reject for packaged Agents | Adds a dependency the app already contains. |
| Download another Node at first run | Fallback only | Duplicates bytes, needs network and adds another update channel. |
| **Ship npm beside the existing pinned Node** | **Choose** | The build already verifies the archive; first run can work offline up to registry installation. |

Stage npm on all service platforms. Prepare private `node`, `npm` and `npx` launchers beneath app data, referencing the signed runtime and staged npm. Prepend this directory only to DevHub-managed child processes. Do not edit shell profiles, install globally into system directories, require sudo or alter the user's shell PATH. Preserve the existing Safe-Chain gate for registry installs, including Paseo. The initial Safe-Chain bootstrap remains the explicit pinned bootstrap already used by Setup.

## Security model

- Consent means trusting local executable code. Always show **High risk · Runs local code** for a runtime plugin. Display repository, complete commit SHA, artifact and lockfile hashes, and **Publisher signature not verified**. A checksum proves identity, not publisher trust.
- Preview pages and exact paths/methods, MCP names and Node commands, requested environment variable names, network declarations, exec declarations, required commands and branding. Never display secret values.
- Pass only declared environment variables, a plugin-local HOME and temporary directory, and a controlled PATH. Reject control variables such as `NODE_OPTIONS`, preload hooks and DevHub authentication variables. Do not pass `process.env` wholesale.
- Use Node permission flags for plugin filesystem access where supported. Separate process, bounded lifetime and path checks reduce accidental damage. Network and exec declarations are disclosures, not a cross-platform OS firewall. [Node's permission model](https://nodejs.org/api/permissions.html) explicitly does not sandbox malicious code. A hostile plugin running as the user can still be dangerous; no claim of hostile-code isolation.
- Confine installer paths, reject symlinks and traversal, validate hashes and refuse changed receipts. Keep the lockfile and bundles pinned. Never load plugin modules into the dashboard process.
- Block new work immediately on disable; cancel active workers. Keep downloaded files and plugin data on removal, matching the existing non-destructive removal contract. Re-enabling requires review.
- Permission comparison treats additions or changed routes, commands, environment, branding and hashes as requiring review. Initial updates use disable/remove/reinstall and full consent. Atomic in-place update and rollback are follow-ups, not silent automatic updates.

## UI and wording

Reuse the Plugins sheet, cards, badges and progress rows. Cancel/Back remains available before confirmation. Keep source identity above the permission sections. No preselected trust checkbox. Installation is authorised by the explicit **Trust and enable** button. Routine loading uses skeletons; button spinners only follow an action.

| Screen or state | Exact wording and actions |
| --- | --- |
| Paste URL | **Add from GitHub**. “Paste the repository URL. DevHub will download a pinned copy for review before running anything.” Field: **GitHub repository URL**. Buttons: **Cancel**, **Review plugin**. |
| Fetch | **Checking repository access…**, **Downloading pinned files…**, **Checking manifest and bundle…**, **Preparing review…**. **Cancel**. |
| Review | **Review {name}**. “Nothing has run yet.” **Source**, **Commit**, **Bundle SHA-256**, **Lockfile SHA-256**, **Publisher signature not verified**. |
| Consent layout | **High risk · Runs local code**. Sections: **Pages**, **API routes**, **MCP servers and commands**, **Environment and secrets**, **Network access**, **Commands**, **Branding**. Empty section: “None declared.” Warning: “Only enable plugins you trust. These permissions describe the plugin; they are not a security sandbox.” **Back**, **Trust and enable**. |
| Missing commands | **Required tools are missing**. “Install these tools in the environment where DevHub runs, then check again.” Inert install hints. **Re-check requirements**. |
| Installing | **Verifying reviewed files…**, **Saving plugin…**, **Syncing selected tools…**, **Enabling runtime…**. Completed stages remain visible. |
| Success | **{name} is enabled**. “Runtime pages and servers are ready to use.” **Open plugin**, **Done**. |
| Partial failure | **{name} needs attention**. “The plugin was saved, but an operation did not finish. Check its status before retrying.” **Copy diagnostics**, **Close**. Never label partial activation as success. |
| Private/no access | **DevHub couldn’t access this repository**. “Sign in to GitHub in the environment where DevHub runs, or use an account with access.” **Check again**, **Edit URL**. Keep the existing access diagnostics. |
| Incompatible API | **This plugin needs a different DevHub plugin API**. “Update DevHub or ask the publisher for a compatible release.” **Close**. |
| Missing artifact | **Runtime bundle is missing**. “Ask the publisher for a release with a prebuilt runtime bundle and lockfile.” **Close**. |
| Checksum mismatch | **Runtime files failed verification**. “The files do not match the manifest. Nothing was run. Download and review the plugin again.” **Close**. |
| Offline | **Couldn’t download the plugin**. “Check your connection, then try again. Installed plugins remain available.” **Try again**. |
| Worker/MCP failure | **Plugin request failed**. “The plugin did not return a valid response before the time limit. Try again or disable it in Plugins.” Do not include stderr or secret-bearing output. **Retry**. |
| New permissions | **Review changed permissions**. “This version requests different access. Your previous approval does not cover it.” List added/changed permissions. Initial release requires removal and a fresh review. |
| Disable | **Disable {name}?** “Runtime pages, branding and MCP endpoints will stop. Downloaded files and plugin data will be kept.” **Cancel**, **Disable plugin**. |
| Remove | **Remove {name}?** “Remove this registration and unchanged synced copies. Downloaded files and plugin data will be kept.” **Cancel**, **Remove plugin**. |
| Disabled/empty | **Disabled**. “Review this plugin before enabling it again.” **Enable…**. No runtime pages: “This plugin has no pages.” |
| Page load | Content-shaped skeleton. Failure: **Couldn’t load this plugin page**. “Try again or check the plugin in Plugins.” **Retry**. |

### Agents first run

The Node/npm rows say **Included with DevHub** when the private toolchain is available. No download prompt is needed for those bytes. The Tools step says “DevHub includes Node.js and npm for Agents. Install Safe-Chain, then set up Paseo.” The action remains **Install Safe-Chain**, followed by **Set up Paseo**.

Progress: **Preparing bundled Node.js…**, **Checking bundled npm…**, **Installing Safe-Chain…**, **Installing Paseo…**, **Starting Paseo…**. Only display work actually taking place. A damaged or old package says **Bundled tools are unavailable** and “Update or reinstall DevHub, then try again.” Offer **Re-check**. Offline registry access says **Couldn’t download agent tools** and “Node.js is ready. Connect to the internet, then retry the installation.” **Try again**. Existing installed tools continue to work offline. Checkout users retain their system toolchain and existing setup instructions.

## Migration and follow-ups

Old manifests stay valid in checkout mode. Runtime declarations are optional and independently versioned; old packaged apps reject the unknown field rather than execute it. Legacy dashboard modules, overlays and providers remain build-time only. Runtime-capable manifests should keep checkout declarations only when the publisher supports both paths; the new runtime must cover its features explicitly.

Initial portable workers do not support native addons, streaming, durable MCP sessions or core component overlays. Do not advertise an unchanged legacy plugin as compatible. Follow-ups: supervised HTTP-server artifacts per platform, authenticated release downloads with publisher signatures, atomic update/rollback, stronger OS sandboxing, a public database-provider RPC contract and platform desktop smoke tests. These require separate compatibility work rather than copying private code into core.

## Changes needed in the BI plugin

Read-only inspection found a checkout-oriented dashboard, an MCP package that runs TypeScript through tsx, local branding assets, a core overlay and a database provider. No private implementation is copied here.

Its publisher needs to bundle the page/API code and dependencies into a portable runtime entry, adapt MCP to the stateless transport or wait for the supervised transport, declare environment/network/exec access, provide the lockfile and hashes, convert branding to the runtime data contract, and remove core-internal imports from that entry. The overlay and database-provider integration continue to require checkout mode until public runtime contracts exist. Streaming and long-running operations need the later server transport. Publish and test the runtime artifact from that private repository separately; this work does not change it.

## Decisions for John

- Default: portable request workers first. Large existing plugins need adaptation; no hidden in-app compiler.
- Default: all local executable plugins are high risk and unsigned unless a future verified signature path says otherwise.
- Default: no automatic updates. Full review for every new version; keep data on disable/remove.
- Default: no arbitrary CSS or signed app-icon replacement. Branding is validated data and local assets.
- Default: reuse bundled Node and ship npm. No second download, sudo or shell profile changes.
- Default: Windows services run in WSL2; native Windows service execution is not advertised.

## Verification

Add focused tests for manifest validation, bundle/lockfile identity, changed permissions, scoped environment, path traversal/symlinks, worker input/output limits and disable cancellation. Test the Node staging checksum path with mocked network responses. Exercise the neutral example's page, API and MCP flow. Review the rendered Plugins UI on an isolated checkout server. Finish with root `npm run verify`; record actual results and platform limitations in the local result file.

## Initial delivery boundary

The implementation uses the portable worker option above. The generic example exercises a page, an API route and a stateless MCP endpoint. Managed agent launches receive runtime MCP endpoints; restricted reviewer launches keep their explicit server list. Enabling does not start a persistent server. The first request launches a bounded worker, so the success message says when code will run.

The existing installer keeps its GitHub access, progress and retry screens. Runtime review adds the risk warning, hashes and capability inventory. The full wording table is the target for later installer polish; this delivery does not add an in-place update screen or a permission-diff screen. Updates require removal and a fresh review, including fresh consent for changed executable bytes. Branding selection is explicit from the runtime plugin page and can be restored to the default.

The bundled toolchain needs no Node download prompt. Existing Safe-Chain and Paseo install controls remain. Download progress and offline retry for registry packages use those existing controls. Runtime release downloads, signatures, durable plugin services, native dependencies and platform desktop smoke tests remain follow-ups. An unchanged checkout plugin is not accepted as a runtime plugin.

The iframe limits same-origin access, scripted fetches and subresources. It is not a network firewall: a frame can navigate itself, and worker network declarations are disclosures. The Node permission model is a guard against ordinary mistakes, not a boundary against a malicious publisher. Exec consent permits descendants that are not constrained by Node's filesystem permissions.
