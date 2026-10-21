---
title: DevHub next
description: Implementation plan and recorded decisions for the Paseo workflow, editor integration, Jira/GitHub adapters.
order: 3
icon: Compass
tags: [plans, editor, paseo]
---

# DevHub next: decisions and implementation plan

Implementation in progress · 9 October 2026. Paths are repo-relative. Each section records its decisions and verification as it lands in private main.

## Executive summary

Keep DevHub as the place where work is tracked, discussed and approved. Reuse an existing editor runtime. Keep Paseo responsible for running assistants.

| Topic | Verdict and recommended approach | Effort | Top risks | Order and reason |
| --- | --- | --- | --- | --- |
| Better Paseo integration | **Feasible; extend the existing system.** Add a durable workflow around task-linked planning, implementation, verification, review and approvals. Keep Paseo chat embedded. | **L**; stronger isolation is **XL** | Full-auto agents can bypass app approvals; stale review evidence; session/state drift | **1.** Gives every later feature a task, session and decision to attach to. |
| Editor and AI-on-selection | **Feasible without building an IDE.** Reuse the diff viewer first; add on-demand code-server plus a small selection extension. Keep a connected Cursor/VS Code extension optional. | **L**; first selection slice **M** | Webview/iframe compatibility; extension licensing; editor memory and update burden | **2.** Replaces the Cursor review hand-off inside the workflow. |

Effort: **S** bounded change; **M** several components; **L** multi-phase/platform work; **XL** substantial runtime/security work. Relative sizes, not delivery promises.

**Scope:** retain local files; no custom IDE, cookie extraction or replacement agent runtime. The separately requested Graphite Neon refresh is recorded in section 5. External facts are linked; compatibility, licences and prices need rechecking before distribution.

## 1. Editor and AI-on-selection

### Baseline before implementation (with file paths)

- `dashboard/components/repo-git/GitDiffView.tsx` already exposes selection-to-AI. `ChangesPanel.tsx:507` builds the snippet prompt; `dashboard/lib/agent-job.ts` routes it into the Paseo handoff sheet. Its `forceTerminal` option and terminal toast are stale.
- `dashboard/lib/cursor-open.ts`, `dashboard/app/api/repos/[name]/open/route.ts` and `dashboard/lib/notes/cursor-draft.ts` open a worktree and editable Markdown note in Cursor, with an apply-back step.
- Existing editors: BlockNote for notes, CodeMirror for SQL (`dashboard/components/db/SqlEditor.tsx`); there is no general code-editor workspace. Notes AI in `dashboard/lib/notes-ai/stream-chat.ts` is a separate document-editing integration.
- `dashboard/components/persistent/PersistentAgents.tsx` embeds Paseo; `dashboard/lib/paseo/dispatch.ts` already creates and resumes conversations.

### Options compared (short table)

| Option | Fit | Main cost or limitation |
| --- | --- | --- |
| Existing diff viewer + small file viewer | Fastest selection/chat slice; enough for reviewing changes | Does not replace project editing; keep deliberately small |
| **code-server**, embedded on demand | Existing VS Code-derived editor, server-side filesystem/extensions; recommended editing option | Additional process, extension host, authentication and upgrade lifecycle |
| **OpenVSCode Server** | Similar experience, closer upstream workbench | DevHub must own service/auth integration; upstream documents unauthenticated access unless a connection token is configured |
| **vscode.dev / VS Code for the Web** | Useful external destination | Browser-only extension/runtime limits; remote tunnels add a service dependency. No verified general-purpose embedding contract |
| Installed Cursor/VS Code + DevHub extension | Lowest extra runtime cost; sends selections and follows task/session links | Selection still happens outside DevHub; cannot alone retire the hand-off. URI handlers alone cannot capture arbitrary selections or unsaved text |

[code-server](https://github.com/coder/code-server/blob/main/LICENSE) and [OpenVSCode Server](https://github.com/gitpod-io/openvscode-server/blob/main/LICENSE.txt) publish MIT licences. That does **not** grant Microsoft Marketplace access: [Microsoft's FAQ](https://code.visualstudio.com/docs/supporting/faq) restricts the Marketplace and Microsoft-distributed extensions to its product family. Use Open VSX or publisher-authorised VSIX files; check each extension's licence and publisher identity. Cursor currently uses [Open VSX through its own proxy](https://prod.cursor.com/help/customization/extensions). Do not assume Microsoft's Remote WSL, debugger or Copilot extensions are available/licensed in either fork.

### Recommendation

Start with selection chat beside the diff, then optional **code-server** for the actual worktree. Reuse its language/extension support and maintain only a small DevHub selection extension, also usable in installed editors.

Keep code, review note and Paseo together. Default to **Review in DevHub**; external editor access stays secondary. [vscode.dev's documented limitations](https://code.visualstudio.com/docs/remote/vscode-web) make it an external fallback, not the local embedding foundation. [OpenVSCode authentication](https://github.com/gitpod-io/openvscode-server/blob/main/README.md#securing-access-to-your-ide) remains the fallback candidate if the code-server spike fails.

### Architecture (Tauri desktop on macOS; Windows where the service runs in WSL2; Linux)

`dashboard/lib/editor/` owns editor lifecycle and selections. The extension sends `workspaceId, relativePath, revision, ranges, selectedText, documentVersion, dirty, source`; the server validates the workspace and previews the exact context before sending it to Paseo. Unsaved text must be labelled, not silently replaced with disk contents.

| Platform | Placement |
| --- | --- |
| macOS | code-server runs beside the Node service; WKWebView displays its isolated loopback origin. Test workers, clipboard, shortcuts and authentication in the actual Tauri shell. |
| Windows/WSL2 | Editor server and extension host run in the selected distro, beside the repo on ext4. WebView2 connects through Windows→WSL localhost forwarding. Never treat a Windows path as a WSL path implicitly. |
| Linux | Same service-side editor, rendered by WebKitGTK; test distro webview versions and clipboard separately. |

Use `desktop/sidecar/supervisor.mjs` ownership patterns and `desktop/src-tauri/src/wsl.rs` path handling. Allocate an ephemeral loopback port, avoiding dashboard 1337, terminal 1339 and Paseo 6767. Start one editor lazily; require saved-buffer confirmation before explicit shutdown. There is no idle shutdown. Coder recommends at least [1 GB RAM and two CPU cores](https://coder.com/docs/code-server/requirements); this is a host recommendation, not measured incremental usage. Measure RSS/CPU for idle, indexing and two worktrees.

For installed VS Code on Windows, place the extension in the appropriate [remote extension host](https://code.visualstudio.com/api/advanced-topics/remote-extensions). Test Cursor's WSL support separately. URI handlers navigate/pair; an authenticated local API carries context.

### Security and privacy

Use short-lived, workspace-scoped pairing credentials; never give extensions the dashboard's global secret. Keep editor and dashboard origins separate, validate exact message origin/source, and avoid credentials or snippets in URLs. The existing same-origin guard is insufficient authentication for a new external client.

Resolve real paths beneath approved roots, reject symlink escapes, bound selection size and exclude secret files by default. Opening a workspace grants the editor/its extensions substantial filesystem access; it is not a sandbox. Restrict extension installation, disable unnecessary telemetry, retain licence notices, and show which AI provider receives selected code. Do not automate Cursor's private chat APIs or assume a Cursor subscription funds arbitrary API requests.

### Phased plan with acceptance criteria and tests per phase

| Phase | Acceptance criteria | Tests |
| --- | --- | --- |
| **1 · Selection chat (M)** | Diff selection opens a task-linked side conversation with a context preview and existing-session choice; no forced navigation or duplicate worktree | Correct staged/unstaged revision, deleted lines, Unicode, busy session, daemon unavailable, duplicate click |
| **2 · Editor spike (S)** | Pinned code-server works inside all three actual desktop webviews; record resource measurements and extension inventory before committing to packaging | Auth expiry, WebSocket reconnect, clipboard, keyboard/IME, WSL paths, two worktrees, unsaved-buffer recovery |
| **3 · Productise (L)** | Managed install/update/rollback and selection extension; review note stays beside code; optional desktop extension uses the same contract | Traversal/symlinks, hostile messages, secret-file exclusion, crash/restart, packaged upgrade and uninstall leaving repos intact |

### Open questions for John

**Decisions · 9 October 2026**

- Ship selection discussion first. Default to a separate explanation conversation in the current checkout, with an explicit task and existing-session choice. Do not create a duplicate worktree or navigate away from the diff.
- Make editing an optional download. Pin code-server 4.141.0 and verify the official asset digest before activation. Keep versioned installs and a previous-version rollback; no background updates.
- Start with built-in language support plus DevHub Selection. Disable telemetry and extension auto-updates; initialise an allowlist for that add-on. Additional extensions require a deliberate settings change and licence review.
- Use one editor process and workspace at a time. Keep recovery data outside Git, require saved-buffer confirmation before stopping, and avoid idle shutdown. An owned supervisor stops descendants if DevHub dies.
- Pair Cursor, VS Code and code-server through the same selection API. Use 30-minute workspace credentials and a 10-minute in-memory preview inbox; the add-on cannot dispatch an assistant. Label unsaved buffers, bound text size and reject secret filenames and symlink escapes.
- Keep the editor on a separate authenticated loopback origin. Windows runs it in WSL; no implicit Windows-path conversion. Native webview parity remains unverified on this Mac and is not claimed.

**Implemented:** Changes selection preview and embedded Paseo conversation; discussion task roles; optional editor install/start/stop/remove/update/rollback controls; scoped pairing and revocation; TypeScript selection add-on; packaged resource staging and setup guide at `docs/guides/editor.md`.

**Verification:** focused tests cover selection boundaries, Unicode/deleted lines, pairing scope/expiry/revocation, version activation/rollback, and preserving the implementation Resume target. A crash test verifies owned-child cleanup. The pinned macOS runtime installs and starts. `npm run verify`, the extension typecheck and the owned-process crash test pass. Browser checks cover desktop/mobile selection preview, busy-session errors, one dispatch on double-click, localhost iframe login, real add-on pairing, two successive code-server selections after a URL-loaded preview, and password recovery after reopening `/editor`; no page errors or horizontal overflow were observed. A startup sample for the owned editor group measured five processes, 870 MiB RSS and 25.9% CPU; this is not an idle/indexing budget. Actual desktop webviews, WSL, IME, packaged upgrades, large-workspace indexing and recovery under forced shutdown remain platform acceptance work. The optional runtime is available for local use; parity across those platforms is not claimed.

## 2. Better Paseo integration

### Current state in the code (with file paths)

- The target is `docs/assets/demos/implement-flow.gif` and its source `docs/assets/demos/src/implement-flow.html:192`, explained in `docs/guides/feature-tour.md:24`: ticket → plan → implement → verify → second-assistant review → fix/resolution → approve commit/push → approve draft PR → approve Jira transition. It is explicitly an illustration; its Cursor pane should become DevHub's code/review pane.
- Tasks now live in `tasks/items/<id>.json`; `shared/tasks/types.ts` has stable identity, links, `jiraKey` and only a draft stage. Daily-file references in older instructions are outdated.
- `dashboard/lib/tasks/task-agent-runs.ts` stores runs/handoffs; `task-agent-resume.ts` and `task-pr-watch.ts` support resume and PR attention. See `docs/guides/plan-loop.md` and `task-agent-handoff.md`.
- `dashboard/lib/agent-runs/run-files.ts` already holds activity/task context, parent run, worktree, base SHA and conversation/message IDs. `dashboard/lib/paseo/lifecycle.ts` reconciles individual turns; completed chat output does not prove verification passed.
- Planning is not a first-class linked run in the task sidecar; `dashboard/app/api/tasks/implement/review/route.ts` explicitly omits task linkage for reviewers. `launch.ts` selects full-auto modes, and `lifecycle.ts` auto-confirms supported provider permissions. Review “read-only” is currently an instruction.

### Options compared (short table)

| Option | Verdict |
| --- | --- |
| More task chips inferred from chat text | Cheap, but cannot reliably represent checks, review or approvals |
| **Durable DevHub workflow; Paseo runs conversations** | Recommended: extends current ownership and preserves recovery |
| Move everything into Paseo or replace its UI/runtime | Couples product state to an external runtime; unnecessary rewrite |

### Recommendation

Add `notes/.config/task-workflows/<taskId>.json`, keyed by canonical task ID. Migrate lazily, preserving legacy records. Separate task completion, workflow stage, run status and external ticket/PR status.

Use stages `plan → implement → verify → review → approve → draft-pr`, with a separate `active | waiting-user | blocked | paused | complete | abandoned` status. Failed checks return to implementation; changed code invalidates checks/review; draft PR creation does not complete the task.

Link each attempt's role, run/conversation/message IDs, worktree, plan revision, code fingerprint, evidence and external refs. Resolve legacy aliases. Several reviewers must not change Resume's implementation target. Record check exits, findings/resolutions and proposal outcomes; never infer success from prose.

### Architecture (Tauri desktop on macOS; Windows where the service runs in WSL2; Linux)

Proposed `dashboard/lib/workflows/` owns validated transitions, per-task locking, atomic persistence and an append-only event history. Persist an idempotent dispatch intent before calling Paseo; reconcile uncertain submissions by existing message IDs before retrying. Start with the current reconciliation loop, then stream workflow events to the UI with polling/replay recovery.

Keep a stage strip, “needs you” action, evidence/diff pane and `PersistentAgents.tsx`; do not scrape Paseo's DOM. Link each role's chat. Resume its conversation/worktree or create a replacement from the handoff and record that relationship.

| Platform | Placement and lifecycle |
| --- | --- |
| macOS | State stays in app data; Node owns workflow, launchd-managed Paseo owns agents; Tauri handles notifications. |
| Windows/WSL2 | Workflow, worktrees and Paseo remain inside one distro; Windows WebView2 presents them. Windows credentials/session paths are not substituted for WSL ones. |
| Linux | Same Node/Paseo contract using systemd user services and desktop notification bridge. |

Reuse `dashboard/lib/desktop/bridge.ts` notifications. Notify once for questions, failed checks, review ready, approval needed and PR attention; retain an unread inbox across restart. Closing the window must not cancel Paseo. While DevHub is fully stopped, reconcile on reopening and label notification delivery as delayed.

### Security and privacy

Persist proposals for **commit/push**, **draft PR**, **Jira transition** and **task completion**, each bound to the exact worktree/HEAD or dirty-tree fingerprint, destination, content hash and expiry. Human approval is authenticated, single-use and recorded; changed evidence invalidates it. Publication timeouts become “outcome unknown” pending a remote check.

App-owned publication can enforce these gates, but unrestricted assistants can still run Git/API commands themselves. Remove auto-confirm from managed approval requests; do not describe the workflow as a sandbox. A guaranteed barrier additionally needs isolated harness execution, restricted Git metadata/credentials/network and scoped MCP operations. Unsupported providers must be visibly ungated or unavailable in strict mode. Protect approval storage from agent writes in that mode.

Reviews should use immutable snapshots/restricted execution where supported. A missing assigned reviewer stays blocked until John explicitly chooses a fallback; do not silently label self-review as second-assistant review. Keep transcripts local and minimise outbound notification content.

### Phased plan with acceptance criteria and tests per phase

| Phase | Acceptance criteria | Tests |
| --- | --- | --- |
| **1 · Track all work (M)** | Every planning/implementation/review attempt appears under one task; restart reconstructs state without relaunching work | Legacy IDs, concurrent writes, duplicate/out-of-order events, missing conversation, daemon restart, ambiguous dispatch |
| **2 · Evidence and decisions (L)** | Demo flow works with structured checks, linked reviewer findings and explicit publication proposals; stale evidence blocks progression | Failed baseline, reviewer unavailable, must-fix loop, changed HEAD, double approval, wrong task, expired proposal, publication timeout |
| **3 · Complete the UI (M)** | Stage strip, code/review/chat, resume and persistent attention inbox work without Cursor; PR watcher feeds the same task | Screenshot/keyboard review on three platforms; sleep/wake, offline recovery, denied notifications, no repeated alerts |
| **4 · Strict mode (XL, separate decision)** | Only supported isolated providers can claim enforced review/write boundaries | Attempts to modify approval records, commit/push directly, access unrelated repos/credentials or bypass scoped APIs all fail |

### Open questions for John

**Decisions · 9 October 2026**

- Require an assigned second assistant and a fresh review after code changes. Missing reviewers block progression; self-review does not count.
- Keep commit and push in one proposal, with the repository, branch and exact message visible. Draft PR, ticket transition and completion each need their own proposal.
- Ship coordination first. Managed task turns no longer auto-confirm provider permission requests. Strict isolation is deferred: local assistants still have command access, and the UI says so.
- Keep an unread attention list on disk and reconcile it on reopening. Notifications are delivered while DevHub runs; fully quitting does not create another daemon.
- Reuse the existing cross-process lock for workflow files so the dashboard and command-line clients cannot lose each other’s decisions. Verification records command exits; assistant prose alone never passes a check.

**Implemented:** `/workflow` provides the attention inbox; task menus open the task’s checks, reviewer conversations, findings, proposals and update history. Run recovery preserves the implementation Resume target. Code changes invalidate evidence, approvals expire after 15 minutes, and each approval and check execution is consumed once. PR attention uses the same history. Review verdicts are explicitly recorded after reading the assigned reviewer; they are not extracted from chat prose.

**Verification:** workflow persistence, concurrent updates, fingerprints, failed checks, stale/expired/wrong-task approvals, duplicate execution and uncertain publication have automated coverage. Desktop and phone-width browser captures use a synthetic task; no live publication or external notification is sent during verification. Native Windows/WSL and Linux webviews have not been exercised on this Mac.

## 5. Graphite Neon refresh

### Decisions · 10 October 2026

Keep Shift Dock's exact background and hub colours: charcoal `#111416` and lime `#9ed84a` in dark mode; `#f7f8f9` and `#4c840c` in light mode. The preset stays **Graphite Neon**, described as **Layered charcoal + electric lime**. Graphite remains the core fallback; plugin defaults, saved selections and Hollow's October switch keep their existing rules.

Use the existing Instrument Sans display face, stronger page titles and clearer subtitle spacing. Rounded panels echo the logo's rows, with a faint surface highlight and shallow shadow. Light mode uses white cards over pale mineral surfaces and softer overlay shadows. Only active navigation gets the lime outline and docked square; static cards stay still.

Small text uses separate accent ink, with brighter hints in dark mode and darker hints in light mode. Inputs and ghost buttons have a visible boundary. Keyboard focus uses an opaque two-pixel outline with a three-pixel gap, including appearance swatches that previously cleared their outline inline. Text selection and carets use the same palette.

Keep status semantics: mint success, amber warning, coral danger and blue information. Empty states retain their real title, explanation and next action; their icon gets a quiet lime tile and the title carries more weight. Errors keep their problem text and **Retry** action. No theme-specific jokes replace useful recovery instructions.

Content loaders retain their content-shaped skeletons. A faint lime band moves through them using a transform; it stops under reduced motion and **Toggle animations**. The primary button lifts one pixel on pointer hover, then settles on press. Disabled buttons do not lift. No ambient animation is added to healthy content.

Git charts use eight separate series colours, starting with lime, with mode-specific contrast. Labels, branch geometry and merge shapes remain intact. The original eight colours stay as CSS fallbacks for every other theme. Runtime plugin branding remains validated data, as specified in `runtime-plugins-and-node.md`; this refresh adds no plugin CSS injection.

### Verification

`npm run verify` passes, including the production build, with one test worker and two build threads. The contrast check passes all 12 variants with no failures or warnings. The expanded suite covers all five Graphite surfaces, small text at 4.5:1, tinted status badges, primary buttons in both states, and control outlines/chart strokes at 3:1. Preset and Hollow seasonal tests pass. Verification also exposed a timestamp tie in an unrelated AI activity test; it now identifies the second run by ID rather than assuming unique creation times.

Real Chrome checks cover both modes at desktop and phone widths, keyboard focus, hover/press/disabled states, reduced motion, the animation switch and Hollow's October default. No horizontal overflow or page errors were observed. Empty, loading and error states use shared production components in a local fixture. A further browser check confirms branch-label contrast of at least 5.23:1 in dark mode and 7.56:1 in light mode. Native desktop webviews remain untested. Evidence is recorded in `.devhub/autorun/a-theme.result`; screenshots stay local under `.devhub/screens/a-theme/`.
