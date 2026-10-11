---
title: DevHub next
description: Implementation plan and recorded decisions for the Paseo workflow, editor integration, generic integrations and a managed browser.
order: 3
icon: Compass
tags: [plans, editor, paseo, browser, integrations]
---

# DevHub next: decisions and implementation plan

Implementation in progress · 9 October 2026. Paths are repo-relative. Each section records its decisions and verification as it lands in private main.

## Executive summary

Keep DevHub as the place where work is tracked, discussed and approved. Reuse an existing editor and browser runtime. Keep Paseo responsible for running assistants.

| Topic | Verdict and recommended approach | Effort | Top risks | Order and reason |
| --- | --- | --- | --- | --- |
| Better Paseo integration | **Feasible; extend the existing system.** Add a durable workflow around task-linked planning, implementation, verification, review and approvals. Keep Paseo chat embedded. | **L**; stronger isolation is **XL** | Full-auto agents can bypass app approvals; stale review evidence; session/state drift | **1.** Gives every later feature a task, session and decision to attach to. |
| Editor and AI-on-selection | **Feasible without building an IDE.** Reuse the diff viewer first; add on-demand code-server plus a small selection extension. Keep a connected Cursor/VS Code extension optional. | **L**; first selection slice **M** | Webview/iframe compatibility; extension licensing; editor memory and update burden | **2.** Replaces the Cursor review hand-off inside the workflow. |
| Generic integrations and chat | **Feasible incrementally.** Capability-based adapters around existing Jira/GitHub code, then opt-in Slack/Telegram notifications. Defer WhatsApp pending demand and pricing checks. | **L** overall; notifications **M** | Provider-specific semantics; plugin installer limitations; unintended disclosure | **3.** Generalises a working flow and reuses its events. |
| Built-in browser | **Managed Chrome with an in-app live view.** Dedicated profile, explicit human takeover, approved file transfers and a native window option on macOS/Linux; Windows/WSL disabled. | **L**; native Chromium embedding **XL** | Authenticated-session access; Windows/WSL boundary; takeover races and browser updates | **4.** Highest security/platform cost; can ship independently once run ownership exists. |

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

## 3. Built-in browser

### Current state in the code (with file paths)

- `mcp/shared/playwriter.json` launches `dashboard/lib/mcp/playwriter-compact.ts`, a wrapper around Playwriter that trims tool descriptions. `dashboard/lib/mcp/cursor-acp-surface.ts` prioritises it within Cursor's tool budget. This is an external-browser MCP integration, not a DevHub-owned browser lifecycle.
- `desktop/src-tauri/src/lib.rs`, `capabilities/main.json` and `dashboard/lib/desktop/bridge.ts` provide the shell and external-link handling; no managed browsing workspace was found.
- `desktop/sidecar/supervisor.mjs` owns its child processes. `desktop/src-tauri/src/wsl.rs` and `docs/architecture/desktop-windows-wsl.md` establish the Windows shell/WSL service split.

### Options compared (short table)

| Runtime | Feasibility | Trade-off |
| --- | --- | --- |
| **Managed Chrome side window + CDP** | **Best first release** | Real visible browser and native human input; extra browser processes and lifecycle/version work |
| Chromium/CEF embedded view | Possible, **XL** | Consistent engine, but substantial packaging, signing, updates, focus, downloads and platform integration |
| CDP-rendered live stream inside DevHub | Possible second phase | Watch/input surface without native embedding; latency, coordinates, IME, accessibility and takeover need work |
| Tauri webviews | Fine for bounded app pages | WebView2 is Chromium; WKWebView and WebKitGTK are not CDP-compatible Chrome substitutes. Separate automation backends would be needed |

Tauri 2 uses [platform webviews](https://v2.tauri.app/reference/webview-versions/); CEF needs a separate spike. [Playwright CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) is Chromium-only and lower fidelity than its own protocol. Test required operations. Arbitrary sites may prohibit dashboard iframe embedding.

| Session strategy | Decision |
| --- | --- |
| Reuse the everyday Chrome profile | **Reject.** Exposes unrelated accounts/tabs, risks profile locking/corruption and conflicts with Chrome's debugging restrictions |
| One-time cookie/profile import | **Defer.** Fragile across engines/OSes; duplicates credentials and may miss local storage, passkeys, device binding or SSO state |
| **Dedicated DevHub profile; sign in once** | **Recommend.** Clear ownership, persistent login and independent reset; agents still gain access to every authorised account in that profile |

Since Chrome 136, remote-debugging port **and pipe** switches require a non-default user-data directory. See [Chrome's announcement](https://developer.chrome.com/blog/remote-debugging-port). On macOS, cookie encryption depends on Keychain material named “Chrome Safe Storage” in the cited implementation ([Chromium source](https://chromium.googlesource.com/experimental/chromium/src/+/refs/tags/71.0.3578.23/components/os_crypt/keychain_password_mac.h)). Windows used DPAPI and added [app-bound encryption](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html), binding decryption to Chrome's identity. Cookie databases are not portable; do not extract keys or weaken protection.

### Recommendation

Launch an installed, supported Chrome with a separate persistent user-data directory and a clearly labelled DevHub window. John signs in there manually. Offer **Watch**, **Take control**, **Resume agent**, **Stop** and **Reset profile**. Retain Playwriter for explicit existing-tab work; new jobs use the broker.

A control lease binds profile/tab to run and owner. Takeover revokes the agent lease, cancels queued commands and waits for an in-flight operation to settle before confirming human control. It cannot undo a request already sent. Resume re-observes the page before issuing actions.

### Architecture (Tauri desktop on macOS; Windows where the service runs in WSL2; Linux)

A proposed broker exposes navigation, observation, click/type and screenshots through opaque session IDs. Start on demand; keep profiles outside Git/content sync and app bundles.

| Platform | Placement |
| --- | --- |
| macOS | Native Chrome/profile; broker beside Node, supervised with owned-process shutdown. Tauri displays controls and later a stream. |
| Windows/WSL2 | Native Windows Chrome/profile and a narrow Windows helper. Helper opens an authenticated outbound connection to the WSL service through existing localhost forwarding; CDP stays on Windows loopback. Do not expose raw CDP on a WSL/LAN address. |
| Linux | Native Chrome/Chromium and broker under the same desktop user; validate Wayland/X11 behaviour and available secure profile storage. |

Prefer an owned debugging pipe when the chosen launcher supports it; otherwise bind an ephemeral CDP port to loopback and keep it private to the broker. Windows helper authentication must use per-launch credentials through inherited handles/stdin, not command-line secrets. Test NAT and mirrored WSL networking rather than assuming both loopbacks are identical. Define explicit upload/download transfer across Windows/WSL.

Start with one profile process and capped tabs. Measure RSS/CPU; stop hidden streams. Handle updates, crashes, profile locks, downloads and orphan cleanup.

### Security and privacy

CDP has account-level power: it can inspect authenticated content and extract cookies. OS encryption protects data at rest, not an authorised debugging session. Loopback reduces network exposure but does not stop another same-user process; an unrestricted local agent can bypass a broker. Strict isolation is a separate requirement.

Grant per-task/profile access with site approval and a visible indicator. Use temporary profiles for unknown sites. Exclude cookie export/raw CDP/arbitrary evaluation; block `file:`, privileged pages and sensitive local services. Approved sessions can still disclose private data or perform unwanted actions.

Pause automation for login/MFA; disable capture then. Define screenshot/download retention; never log credentials or session storage. Treat page text as untrusted input; require explicit approval for sensitive submissions. External pages receive no Tauri capabilities or dashboard credentials.

### Phased plan with acceptance criteria and tests per phase

| Phase | Acceptance criteria | Tests |
| --- | --- | --- |
| **1 · Visible browser (M)** | Dedicated profile persists across restart; watch/takeover/stop work; only owned processes are stopped | Separate from personal Chrome, profile lock, crash recovery, competing commands, no actions after takeover acknowledgement |
| **2 · Platforms and boundaries (L)** | macOS/Linux and native Windows helper work; CDP is never LAN-exposed; access is scoped to the intended run | Port/interface scan, invalid/replayed credentials, wrong run, WSL NAT/mirrored modes, sleep/wake, file transfer, login capture suppression |
| **3 · In-app viewing (M)** | Optional live stream and click-to-take-control; native window remains available | DPI/resize, scrolling, IME, popups, downloads, reduced motion, latency and measured resource budget |

### Resolved browser questions

- Show the live page inside DevHub and retain native Chrome for private sign-in and native interactions.
- Default to a temporary profile. Make saved work sign-ins opt-in and keep everyday Chrome separate; no cookie or session import.
- Stop owned Chrome with the DevHub service. Keep streamed images and transfer bytes in memory; approved downloads use the viewing browser’s save controls.

### Decisions · 9 October 2026

The proposal and acceptance criteria above remain the reference. These decisions resolve the browser questions for the local implementation; they do not mark all three phases complete.

- Use a visible Chrome side window. Add an optional screenshot preview at roughly two-second intervals while the panel is visible and agent access is enabled; keep interaction in Chrome or through explicit action approval.
- Default to a temporary profile. Persistent sign-ins are opt-in, with one separate profile per DevHub work profile. Never import everyday Chrome profiles or cookies. Sign in manually with human control and capture paused.
- Bind one session and one tab to an active task and linked conversation. Grant agent access for 15 minutes at a time. Navigation stays within approved sites; every agent click and typed value needs human approval, valid for one minute.
- Expose observation and bounded action requests, without raw CDP, cookie export, arbitrary evaluation or upload tools. Deny downloads and close extra tabs. Takeover waits for an in-flight command; it cannot undo a request already sent.
- Stop owned Chrome when DevHub's service quits. Keep persistent profiles outside Git and content sync; remove temporary profiles during normal session cleanup. There is no browsing after quit.
- Implement macOS and local Linux desktop support first. Windows/WSL is explicitly unavailable pending a native Windows helper. This does not satisfy phase 2 platform parity.

### Implementation

`dashboard/lib/browser/runtime.ts` owns an installed Chrome/Chromium process through `scripts/owned-runtime.mjs`, a separate profile and a loopback debugging connection. It checks the runtime version, limits the context to one tab, denies downloads and applies the approved-origin policy in `policy.ts`. Persistent profiles are scoped to the active work profile; starting and resetting are explicit dashboard actions.

`lease.ts` manages expiring access and waits for the running command before acknowledging takeover. `commands.ts` returns bounded page observations and opaque element IDs, binds approvals to captured elements, and records uncertain action outcomes without replaying them. Human mode suppresses observation and capture. Login/MFA detection also pauses access, but users still need to take control before entering credentials.

`/browser` offers task/run selection, site consent, temporary or saved profiles, Watch in Chrome, Take control, Resume agent, single-action approval, Stop and saved-profile reset. `BrowserPreview.tsx` keeps optional snapshots in memory and pauses polling when hidden or outside agent mode. It reuses the dashboard's existing tokens, controls, status panels and loading/error components.

The DevHub MCP tools in `mcp-servers/devhub-server/src/tools/browser.ts` expose `browser_session`, `browser_observe` and `browser_request`. They cannot start a session, grant access or approve actions. Requests can navigate within approved sites or propose a click/typed value for dashboard approval. Existing Playwriter remains available for explicit work in an existing browser.

### Privacy and remaining limits

The broker is not an OS or network sandbox. Approved-origin checks, public-address validation and loopback CDP reduce the exposed surface; they do not provide complete network isolation. Unrestricted local agents can bypass the broker. Agent access can expose signed-in page content, so site and profile consent remains consequential.

Observed page text enters AI context and must be treated as untrusted data. Screenshots are held in memory, with no DevHub image archive. `browser_*` tools are omitted from DevHub's MCP history; the AI client may still retain their results and page context in its own transcripts. Human control pauses further capture, not information already returned.

The first implementation supports macOS and Linux with a local display and a recognised installed Chrome/Chromium binary. Native Windows, WSL forwarding, file transfer and phase 2 parity remain unimplemented. The preview is a periodic monitor, not phase 3's full embedded interaction surface. Extra-tab sign-in flows and sites requiring unapproved content hosts may not work. The setup and control guide is `docs/guides/managed-browser.md`.

**Verification:** `npm run verify` passes. Automated tests cover expired/replayed leases, competing commands, takeover before and during operations, a takeover racing with resume, stale/expired action approval, wrong task/run, uncertain outcomes and privileged/private URL rejection. A native macOS Chrome smoke test uses an isolated fixture profile: a test cookie survives restart, approved typing runs once, old access is rejected, human/login capture is suppressed, and the debugging listener is IPv4 loopback only. A startup sample measured nine owned Chrome processes, 1,197 MiB RSS and 146.8% aggregate CPU; this is not an idle benchmark. Desktop/mobile UI fixtures show no page errors or horizontal overflow, one start on double-click, explicit consent, one approval, and no preview control in human mode. Independent finish review marked ship; the contrast check passes all 12 themes. Native Linux, Windows/WSL, sleep/wake, packaged lifecycle and sustained resource budgets remain unverified; the original platform acceptance criteria are not marked complete.

### Embedded browser decisions · 10 October 2026

These decisions supersede the side-window-only restrictions above. Windows/WSL remains disabled; there is no native Windows helper or cookie/session import.

- Use CDP screencast over a same-origin dashboard POST stream. Keep one viewer, acknowledge frames, bound queued images and stop capture when hidden. The first click takes control without forwarding a click. Human input shares the lease's command exclusion; tab switches invalidate old stream tickets.
- Retain native Chrome. Opening it takes human control and stops streaming. Embedded human mode pauses agent observation but still displays images to the user; the UI says this before sign-in. Use native Chrome for private sign-in, accessibility, menus, clipboard copying and drag gestures.
- Fit the viewport to the live view, cap DPI at 2 and send wheel input and committed Unicode composition. Allow four approved-site tabs. Surface website dialogs explicitly.
- Require dashboard file approval. Uploads use a picker and exact live file-input handle, name the receiving frame’s origin and reject a changed frame; no path-based agent API. Rejection is bound to the exact transfer so a delayed click cannot cancel a newer request. Pause document attachment responses and read the exact response after approval. Limit transfers to 20 MiB, expire approvals after one minute and keep bytes in memory. Blob/data and unrecognised downloads remain denied.
- Use a loopback CONNECT proxy. Permit approved hosts on 443 and pin actual connections to public IPs. Disable implicit loopback bypass, direct QUIC and direct WebRTC UDP. Keep Chromium's sandbox enabled. This is not an OS firewall and does not constrain unrestricted same-user programs or every native Chrome feature.
- Keep the browser in core. Long-lived CDP and streaming connections do not fit the portable request-worker transport in `runtime-plugins-and-node.md`.

**Verification · 10 October 2026:** 39 focused tests pass, including installed macOS Chrome and real Chromium screencast/input tests. Coverage includes 2× DPI and resize, scrolling, committed Unicode, popup switching, stale input, frame-bound uploads with MIME preservation, original-response downloads, approval expiry/replay/size limits, delayed rejection, stream backpressure and Windows/WSL disablement. Real-browser desktop/mobile checks pass on the isolated checkout server: start/stop, click-to-take-control, Unicode entry, scrolling, upload approval, an actual HTTPS attachment download, popup tabs, website dialogs, native-window handoff, loading/retry and empty/unsupported/missing-runtime states. No page errors or horizontal overflow were observed. Screenshots and test logs are saved under `.devhub/screens/a-browser/` and `.devhub/autorun/`; these local artifacts are not committed. Linux X11/Wayland, physical IME candidate windows, sleep/wake and actual desktop webviews were not available on this Mac and are not claimed as tested. Full verification and publication results are recorded in the local job report.

## 4. Generic integrations, including chat

### Baseline before implementation (with file paths)

- `dashboard/lib/jira/client.ts` implements Jira REST, ADF, issue creation and transitions; `docs/integrations/jira.md` describes its configuration. `dashboard/lib/github/prs.ts` uses `dashboard/lib/gh-exec.ts`; GitHub login is the local `gh` session (`docs/integrations/github.md`).
- Coupling extends into `shared/tasks/types.ts` (`jiraKey`), `shared/entity-note/`, provider-specific routes and `dashboard/lib/tasks/task-pr-watch.ts`. Generic UI alone would not remove it.
- `docs/integrations/google-calendar.md`, `datadog.md` and `figma.md` show different auth/delivery models; do not force them through a single credential mechanism.
- Tier-2 plugins copy source through `dashboard/lib/plugins/materialize.ts`; `types.ts` and `db-materialize.ts` already support `DbConnectionProvider` imports.
- The installer now supports prebuilt runtime plugins through a separate `request-worker` protocol. Source materialisation and packaged runtime extensibility remain separate capabilities; source integration adapters still require a build.

### Options compared (short table)

| Option | Verdict |
| --- | --- |
| Rename Jira/GitHub UI while keeping direct calls | Cosmetic; leaves state, auth and workflows coupled |
| **Typed capability adapters around existing clients** | Recommended; incremental migration with existing behaviour preserved |
| All operations through generic MCP | Useful agent transport, insufficient alone for typed UI, retries and approval ownership |
| Rewrite all integrations and dynamically import plugins | Excessive scope; unsafe trust model and incompatible with packaged Next.js assumptions |

### Recommendation

Use provider/account-qualified refs and optional capabilities. Preserve native status/transition IDs alongside display categories. Keep issue, PR, CI and task states distinct; wrap Jira/GitHub first.

A proposed minimal server-side contract:

```ts
type Kind = "issue" | "repo" | "pr" | "check" | "doc" | "chat";
interface Ref { provider: string; account: string; kind: Kind; id: string }
interface Item { ref: Ref; title: string; url?: string; revision?: string }
interface Page { items: Item[]; next?: string }
interface Context { signal: AbortSignal }
interface WriteContext extends Context {
  idempotencyKey: string;
  approvalId: string;
}
interface Provider {
  id: string;
  apiVersion: 1;
  get(ref: Ref, ctx: Context): Promise<Item>;
  search(kind: Kind, query: string, cursor: string | undefined,
    ctx: Context): Promise<Page>;
  issues?: {
    create(title: string, body: string, ctx: WriteContext): Promise<Item>;
    transitions(ref: Ref, ctx: Context): Promise<Array<{ id: string; label: string }>>;
    transition(ref: Ref, id: string, ctx: WriteContext): Promise<void>;
  };
  scm?: {
    draftPr(repo: Ref, head: string, base: string, title: string,
      body: string, ctx: WriteContext): Promise<Item>;
  };
  ci?: { checks(pr: Ref, ctx: Context): Promise<Page> };
  docs?: { content(doc: Ref, ctx: Context): Promise<string> };
  chat?: {
    send(channel: Ref, text: string, ctx: WriteContext): Promise<Item>;
  };
}
```

Validate `Ref.kind` and add domain-specific result schemas as consumers migrate. Use typed capability/auth/rate-limit/conflict errors and namespaced provider metadata. The host validates approval records; a supplied `approvalId` is not authority.

### Architecture (Tauri desktop on macOS; Windows where the service runs in WSL2; Linux)

Proposed `dashboard/lib/integrations/` owns contracts, registry, credentials resolution and built-in adapters. Versioned app-data settings hold provider/account IDs, approved endpoint, capabilities and credential reference. The UI receives health/capabilities, never credentials.

On macOS/Linux adapters run in Node; on Windows they run in WSL alongside its `gh` authentication and config. Tauri handles consent/navigation/native notifications. External HTTPS calls need no new inbound ports.

For source installs, propose `dashboard.providers` using DB-provider codegen: modules covered by `dashboard.paths`, version checks, unique IDs and an empty core baseline. Edit plugin sources; require a compatible build/restart.

Packaged builds initially ship approved adapters. Dynamic plugins need a separate reviewed, out-of-process protocol; source adapters are not registered by the separate packaged runtime-plugin protocol. An interface alone does not sandbox plugin code.

#### Outbound notification channels

| Channel | Feasibility, API, cost and limits |
| --- | --- |
| **Slack** | Start with an incoming webhook for one chosen channel; use an OAuth app/`chat.postMessage` for DMs or richer routing. Workspace approval/scopes may be required. Roughly one message/second per channel; honour 429/`Retry-After`. No per-message tariff is established by the API docs; verify workspace/app-plan requirements. [Slack limits](https://docs.slack.dev/apis/web-api/rate-limits/), [webhooks](https://api.slack.com/incoming-webhooks) |
| **Telegram** | Bot API `sendMessage`; user must start the bot or add it to a chat, then bind that chat explicitly. Ordinary bot messaging is free; limits include about one message/second per chat and roughly 30/second broadcasts. Paid broadcasts are unnecessary here. [Bot introduction](https://core.telegram.org/bots), [limits](https://core.telegram.org/bots/faq) |
| **WhatsApp** | Possible through Business Cloud API, with business/number setup and recipient opt-in. Outside the rolling 24-hour user-message window, use approved templates. Pricing is per delivered message and market/category dependent; template classification, quotas, exact UK rates and current free-window exemptions must be verified before implementation. Meta's detailed pricing endpoint returned 429 during research; do not budget it as free. A BSP may add fees. [Messaging policy](https://whatsappbusiness.com/policy/), [pricing](https://whatsappbusiness.com/products/platform-pricing/) |

Send questions, review/approval readiness, failed checks and material PR changes: generic summary and safe link, no code/logs/transcripts. Phone links need a configured secure route or external issue/PR URL; localhost points at the phone. Approvals stay inside authenticated DevHub.

### Security and privacy

Opt in per channel/destination/event/work profile; provide preview, quiet hours and revocation. Consent covers matching templates, not arbitrary agent messages. Telegram bots do not use secret chats; all channels have external recipients/storage.

Keep tokens/webhook URLs out of logs and synced config. Guard endpoints/redirects against SSRF; configure enterprise endpoints explicitly. Use a durable outbox, deduplication, backoff and receipts. Reconcile uncertain sends where possible; disclose possible duplicates.

### Phased plan with acceptance criteria and tests per phase

| Phase | Acceptance criteria | Tests |
| --- | --- | --- |
| **1 · Wrap existing clients (M)** | Jira/GitHub adapters preserve existing routes; qualified refs coexist with `jiraKey`/PR URLs; no credential migration required | Contract fixtures for pagination, auth failure, rate limits, draft state and two accounts with overlapping IDs |
| **2 · Migrate workflow and plugins (L)** | Workflow/UI read capabilities; second issue/SCM provider proves the seam; source plugin registration works and packaged limitations are explicit | Old saved links, unsupported writes, stale revision, duplicate provider IDs, absent/disabled plugin, invalid manifest and core-only build |
| **3 · Notifications (M)** | Slack/Telegram outbox is opt-in and survives restart; WhatsApp stays disabled until policy/rate-card checks and template approval | Consent revocation, redaction, replay/deduplication, 429, network timeout, quiet hours, blocked bot, mobile links; mocked sends by default |

### Open questions — decisions recorded

### Decisions · 9 October 2026

Use GitHub Issues as the second tracker alongside Jira. It proves the provider boundary with credentials DevHub already supports. Keep existing Jira setup and `gh` login as the `default` accounts; add named accounts only when needed, using references to named server environment variables and a service restart.

The first adapters shipped read-only. The 10 October extension adds Jira ticket creation and native transitions, plus GitHub PR creation, title/body updates and draft publication. Each operation uses an expiring, single-use proposal and a separate dashboard confirmation. Provider status, PR state and task completion remain separate.

Start outbound alerts with an opt-in Slack incoming webhook, then an explicitly bound Telegram bot chat. WhatsApp stays parked; no Business API onboarding, templates or pricing commitment is included.

### Implementation

| Area | Local implementation |
| --- | --- |
| Provider contract | `dashboard/lib/integrations/types.ts` defines provider/account/kind/ID refs, native status IDs, revisions, capability checks and typed errors. `registry.ts` rejects duplicate IDs and incompatible API versions. |
| Built-in adapters | `jira.ts` reads/searches issues and lists transitions; `jira-write.ts` prepares and executes confirmed ticket creation/transitions. `github.ts` reads/searches Issues and PRs and reads checks; `github-write.ts` prepares and executes confirmed PR creation, title/body updates and draft publication. Results retain native metadata. |
| Accounts | `accounts.ts` stores named account metadata and credential variable names in profile config. Default Jira uses existing setup; default GitHub uses `gh`. Additional Jira accounts use a Cloud domain, email variable and token variable; additional GitHub accounts use a token variable against `api.github.com`. |
| Task links | `task-refs.ts` adds qualified refs alongside existing `jiraKey` and GitHub PR URLs. Legacy links are derived without rewriting them. Added links use a task lock and revision check; removing one does not remove the original Jira key or PR URL. |
| Dashboard | `/integrations` offers search, inspection, account configuration and alert controls. A task context enables linking results to that task. Existing buttons, inputs, tone panels, loading/error components and responsive layout preserve the dashboard's design. |
| Alerts | `alert-types.ts`, `alert-store.ts`, `alert-send.ts` and `alert-worker.ts` implement fixed templates, consent, a durable outbox and bounded delivery attempts. The setup guide is `docs/guides/integrations.md`. |

### Source providers and packaged runtime plugins

Source installs support `dashboard.providers` through `dashboard/lib/plugins/integration-materialize.ts`. Each declared module exports a default array of `IntegrationProvider` objects. The materialiser generates static imports into `dashboard/lib/plugin-integrations.generated.ts`; core keeps an empty baseline. Edit the plugin source, materialise it and rebuild to apply changes. This is trusted build-time code, not an arbitrary import into a running packaged app.

The separate runtime-plugin work adds a versioned `request-worker` protocol for packaged plugins, with reviewed pages, routes, MCP contributions, permissions and optional branding. A neutral `team-tools` example can list automation actions, review an exact request, stream bounded execution output and read durable status. The plugin owns its input validation, single-use review tokens, credential use and execution policy. A disconnected page must not claim to have stopped a remote operation. See [Runtime plugins and managed Node](runtime-plugins-and-node.md#request-worker-actions) for the contract and scope decisions. Its contract and host live in `dashboard/lib/plugins/runtime-contract.ts` and `runtime-host.ts`. It does not automatically register `dashboard.providers` modules in the integration registry. Source provider registration and packaged runtime contributions remain distinct paths; neither should be described as a sandbox merely because it has an interface or permission inventory.

### Alert consent and delivery

Alerts are off until a destination is enabled. Consent binds the chosen destination, event types and active work profile to a revision and a SHA-256 fingerprint of the resolved credential. Changing the credential requires fresh consent through Change settings; revoked destinations can be reviewed and re-enabled under the same ID. Configuration stores the credential reference and fingerprint, not the token or webhook URL. Enabling a destination validates its configuration but sends no test message.

Messages use fixed labels for conversations needing attention, failed checks, completed reviews, approval requests and PR attention. They include no task titles, source code, logs or transcripts. An optional task link uses a configured HTTPS dashboard origin; without it, the message asks the recipient to open Task workflows. The address must be reachable and authenticated for the recipient; configuring it does not create remote access. Approvals stay inside DevHub.

The outbox is stored in profile state outside content sync. It deduplicates by work profile, destination and workflow event. Only matching events after consent are queued. Delivery runs while DevHub is running and the matching work profile is active; quiet hours use the destination's configured time zone.

HTTP 429 responses retry after the provider delay with backoff, up to five attempts. Rejected requests become failed deliveries. A timeout, ambiguous response or interrupted in-flight delivery becomes **unknown** and is never automatically retried. Manual retry requires checking the channel and acknowledging that a duplicate is possible. Provider acceptance is recorded; it does not prove the recipient read the message.

Revocation cancels queued deliveries. After it returns, another queued send cannot start under that consent. It cannot retract a message already sent. The Slack webhook fixes the recipient channel; Telegram needs an explicit chat ID and does not use secret chats.

### Platform and scope limits

Adapters and the alert worker run in the Node service. Windows uses the WSL service's environment, config and `gh` authentication; macOS and Linux use their local service. No new inbound integration port is required. Named Jira accounts support Atlassian Cloud; named GitHub accounts use GitHub.com. Enterprise endpoint configuration is not part of this slice.

### Decisions · 10 October 2026 · a-integ

- Keep the existing Jira and PR screen response shapes. Their read projections now enter through `integrations/screen-data.ts`, with provider/account capability checks. Jira creation and every existing transition control use the shared proposal/review flow. Retain parent/team/sprint defaults, task refreshes, PR sorting, archived-repository filtering and stale-cache behaviour. Cancelling confirmation also stops the caller's remaining work: no error toast, task completion or new Jira link.
- Add `prepareWrite` and `executeWrite` capabilities for Jira creation/transitions and GitHub PR creation/update/publication. Default PR creation to draft. Update title/body together; do not add merge, close, delete or local Git push. Branches must already exist remotely.
- Persist the input and exact native preview outside content sync. Bind confirmation to its SHA-256, provider identity, account, destination, remote revision and branch SHAs. Expire after 15 minutes; serialize each proposal across processes. Save an unknown outcome before sending so a crash cannot replay it. Changed evidence needs fresh review. Provider APIs still have a compare/send race; this is not a transactional remote lock.
- Accept Slack slash commands first, then Telegram private bot commands through two fixed webhook endpoints. Verify Slack HMAC/timestamps or Telegram's webhook secret and message age; require exact sender/channel/workspace/profile/account allowlists. Reject browser origins, forwarded Telegram messages and bot senders. Deduplicate requests on disk and bound input size and command rate.
- Start with `help`, `status`, `status <proposal-id>` and `propose <action JSON>`. Chat only queues a proposal. The connected user must review and confirm it in DevHub; no chat approval, arbitrary shell command, agent dispatch or automatic provider writes. Telegram webhook responses use the Bot API response-method format. Replies contain fixed status text and IDs, not provider content.
- Configure inbound credentials and allowlists through local server variables and a restart. Keep ingress restricted to the exact webhook paths; remote dashboard access still needs authentication. Inbound consent and outbound-alert consent are separate. WhatsApp stays parked because its paid Business API is outside this job.
- Preserve the source-provider/runtime-plugin boundary from `runtime-plugins-and-node.md`. These adapters are trusted build-time code. Runtime request workers do not gain integration credentials or confirmation authority.

### Write and chat UI

**Write actions** contains labelled forms and an action-specific **Review action…** step. The shared native dialog shows connected account/user, requester, destination and exact content. PR edits show old and new text; Jira transitions show current and destination states. Loading uses skeletons, submission text reflects the active action, and buttons reject duplicate clicks. Cancel is available before execution. Errors preserve the form.

**Recent actions** distinguishes awaiting review, expired, cancelled, failed, succeeded and **Outcome unknown**. Unknown outcomes have no retry button: check the provider before creating another action. The chat section shows disabled, misconfigured, no-allowlisted-sender and enabled states with a setup link. The PR screen links directly to the PR action form.

Named Jira accounts deliberately omit default-account sprint/team inheritance. Native webview parity, live provider submissions and externally exposed ingress are separate operational checks; mocked requests cover the write paths without sending real messages or publishing test content.

### Verification

The earlier read-only/alert implementation passed full verification and browser checks for search, desktop/mobile layouts, consent re-enablement and unknown-delivery recovery.

The 10 October write/chat extension passes `npm run verify`: lint, MCP/dashboard typechecks, 5,227 tests, vendor checks, production build and dynamic-route checks. Nine tests remain skipped by the existing suite. Verification ran with sequential checks, one test worker and two build threads. Added fixtures cover exact provider payloads, native transitions, draft publication, changed remote evidence, tampered confirmation, expiry, concurrent confirmation, crash-safe unknown outcomes, legacy route proposals and cancellation, signed Slack requests, Telegram private-chat authentication, sender/account isolation, replay and rate limits. All provider writes and chat replies are mocked.

Real Chrome checks cover desktop and phone layouts, review loading, exact account/destination/content, old and new PR text, cancellation with preserved input, one proposal and confirmation on double-click, success, unknown outcomes without retry, network-error recovery and chat disabled/misconfigured states. No page errors or horizontal overflow appeared. Production-build checks also cover the Tickets redirect into Work, ticket sorting/search, cancelled transitions without error toasts, confirmed transitions refreshing the status, and the PR screen's stale-cache notice and write-action link. Screenshots stay local under `.devhub/screens/a-integ/`. Live provider submissions, external webhook ingress and native desktop webviews remain unverified.

Browser checks cover search, desktop/mobile layouts, destination re-enablement with fresh consent, one save on double-click, preserved destination identity and acknowledgement before retrying an unknown delivery. No page errors or horizontal overflow were observed. The contrast check passes all 12 theme variants. Native webviews and live recipient delivery remain unverified.

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
