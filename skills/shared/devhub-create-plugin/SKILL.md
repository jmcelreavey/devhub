---
name: devhub-create-plugin
description: Scaffold a DevHub plugin (pages, MCP tools, skills, branding). Use when creating a plugin or turning an integration into one.
metadata:
  short-description: Build a complete DevHub plugin
---

# Create a DevHub plugin

Build a separate, installable plugin repo around the user's actual workflow. Deliver working UI and MCP operations, an intentional theme, installation instructions and verification evidence. A manifest, an attractive mockup or an MCP server that only echoes sample data is a starting point.

For routine changes to an existing checkout plugin, use `devhub-plugin-workflow` if available. This skill owns creation and completing a plugin across its layers.

## Establish the brief

Use the conversation and available project context first. Ask only for missing decisions that affect implementation, bundling related questions:

- Who will use it, and what work should its first useful screen and MCP tools accomplish?
- Is it for the packaged app, a DevHub source checkout, or both? Is distribution personal, internal or public?
- What integrations, credentials and brand assets already exist? Which actions change external state?

If the user says “like BI”, take that as a capability reference. Keep the new plugin's workflows, credentials, naming and visual identity independent. Use BI source as implementation evidence only when it is locally available; never require access to a private example or copy its licensed fonts and artwork.

State the chosen delivery path and first real workflow in one short paragraph, then implement. Continue independent work while credentials or optional design preferences are pending. Label fixture results and unverified live behaviour accurately.

## Choose the delivery path

Locate the current DevHub checkout through the repo tools or user context. Read its `docs/contributing/creating-plugins.md` and inspect the relevant manifest validator before scaffolding.

| User needs | Build |
| --- | --- |
| Install from GitHub in the packaged app, without rebuilding DevHub | A prebuilt request-worker runtime: pages, declared APIs, stateless MCP and runtime branding |
| Native DevHub pages, database-provider hooks, full-app CSS, fonts and desktop branding | A checkout plugin with explicit `dashboard`, `contributes` and `branding` declarations |
| Both installation experiences | Both contracts in one repo, sharing domain logic where practical; verify each independently |

Runtime branding currently accepts palette data and hashed logo/font assets. It does not inject arbitrary shell CSS or replace the signed app icon. Checkout branding supports those broader customisations. Do not promise parity that the installed host does not provide.

Treat the current code as authoritative when older documentation disagrees. Useful entry points under the DevHub checkout:

- `apps/ui/lib/plugins/manifest.ts` — source manifest validation.
- `apps/ui/lib/plugins/runtime-contract.ts`, `runtime-host.ts`, `runtime-files.ts` — portable contract, execution and asset verification.
- `apps/ui/lib/plugins/templates.ts` and `templates/runtime-plugin/` — maintained starters.
- `apps/ui/lib/plugins/branding.ts` and `apps/ui/lib/theme-presets-types.ts` — checkout branding and preset metadata.

Keep all company-specific implementation in the plugin repo. Extend core only when a required generic extension point is missing, as an explicit, separate change.

## Scaffold and implement

1. Inspect the destination and its git status. Create a new sibling repo or use the user-selected plugin repo. Use a stable lowercase slug and namespace routes, tools and contributed assets to avoid collisions.
2. For portable installation, follow [Runtime and MCP](references/runtime-and-mcp.md) and start from the current `templates/runtime-plugin/`. Ship a reproducible bundle and lockfile.
3. For a checkout plugin, run the existing starter from the DevHub root:

   ```sh
   npm run plugins -- new <slug> --out <new-plugin-directory> --branding
   ```

   Use `--dry-run` first if the destination or generated inventory is uncertain. The starter refuses an existing destination. It does not register or publish anything, and its MCP example is inert under `examples/mcp/`; implement and activate a real server before claiming MCP support.
4. Implement the domain operation once, with thin UI/API/MCP adapters. Validate inputs at the service boundary, keep credentials server-side, bound external requests and return useful errors. Reuse the current host helpers in checkout code; portable workers cannot import DevHub modules.
5. Build a complete first workflow: load actual data, expose the intended action, show loading/empty/error states and make recovery work. Add only capabilities requested or needed to complete that workflow.
6. Follow [Theme and experience](references/theme-and-experience.md) for both palette modes and the supported delivery surfaces.
7. Add plugin skills for repeatable domain workflows and agents only for useful specialist roles. Declare these in `contributes`. Give each skill operational instructions with real tool names, inputs and a verifiable outcome.
8. Write a concise plugin README covering prerequisites, credential setup without secret values, install path, available workflows/tools, validation commands and update/disable behaviour. Bump the plugin version when its contributed surface changes.

For a checkout dashboard, mirror the core layout in the plugin's `dashboard/`; list every contributed path in `dashboard.paths` and declare navigation in `dashboard.nav`. Check tracked ownership and overlays before editing. Make all edits in the plugin source, then materialise into DevHub. Use `isSameOrigin` for state-changing API routes and `execExternal` for host subprocesses. A database provider must also be covered by `dashboard.paths`.

## Register and verify

Building locally does not authorise publishing a repository or trusting a new runtime. Finish a concrete, reviewable artifact before any remaining permission request; retain authorisation already given.

For a checkout installation, from the DevHub root:

```sh
npm run plugins -- add <plugin-directory>
npm run plugins -- list
```

For a runtime bundle, review it with `npm run plugins -- add-runtime <plugin-directory>` and trust it in the app when authorised.

Confirm the contributed pages, navigation and branding appear. Run relevant lint, typecheck, tests and build from the host checkout. Sync skills, agents and MCP through DevHub's actions when installation is in scope; verify the catalogue and use a fresh client session to check the tools.

For a packaged runtime, use Plugins → Add from GitHub to inspect the exact commit, hashes and declared access, then the host's trust flow when authorised. Do not write acceptance receipts yourself. Test pages, APIs, MCP and branding through the host, not just by launching the worker.

Verify on the server that runs the changed checkout. Check port ownership, choose a free preview port and separate `DEVHUB_DIST_DIR`, and set `DEVHUB_SCHEDULER=0` for a secondary DevHub server. A packaged app on the usual port does not serve source edits.

The plugin is complete when:

- The manifest validates, referenced assets exist, bundle hashes match, and every promised capability is reachable.
- A real operation works through both the UI and MCP; invalid input, missing credentials and an unavailable dependency produce recoverable errors. Test any mutation using fixtures or an authorised safe target.
- Both theme modes render on desktop and mobile; text, controls, focus and reduced-motion behaviour pass the checks in the theme reference.
- A clean installation can follow the README. Both delivery paths have separate evidence if both are claimed.
- Disable/removal behaviour is verified in a disposable installation, without removing user data or disturbing their daily driver.

If an external credential, publication or install approval is missing, finish the code and local verification, then name that precise remaining step. Report the plugin path, how to use it, checks performed and remaining limits. Do not call fixture-only or worker-only checks a successful live installation.
