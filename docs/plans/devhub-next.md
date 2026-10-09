---
title: DevHub next
description: Decision-focused plan for editor integration, the Paseo work flow, a built-in browser and generic integrations. Not implemented.
order: 3
icon: Compass
tags: [plans, editor, paseo, browser, integrations]
---

# DevHub next: decisions and implementation plan

Decision draft · 9 October 2026. Static investigation; no runtime benchmarks. Paths are repo-relative; new modules and behaviour are proposals.

## Executive summary

Keep DevHub as the place where work is tracked, discussed and approved. Reuse an existing editor and browser runtime. Keep Paseo responsible for running assistants.

| Topic | Verdict and recommended approach | Effort | Top risks | Order and reason |
| --- | --- | --- | --- | --- |
| Better Paseo integration | **Feasible; extend the existing system.** Add a durable workflow around task-linked planning, implementation, verification, review and approvals. Keep Paseo chat embedded. | **L**; stronger isolation is **XL** | Full-auto agents can bypass app approvals; stale review evidence; session/state drift | **1.** Gives every later feature a task, session and decision to attach to. |
| Editor and AI-on-selection | **Feasible without building an IDE.** Reuse the diff viewer first; add on-demand code-server plus a small selection extension. Keep a connected Cursor/VS Code extension optional. | **L**; first selection slice **M** | Webview/iframe compatibility; extension licensing; editor memory and update burden | **2.** Replaces the Cursor review hand-off inside the workflow. |
| Generic integrations and chat | **Feasible incrementally.** Capability-based adapters around existing Jira/GitHub code, then opt-in Slack/Telegram notifications. Defer WhatsApp pending demand and pricing checks. | **L** overall; notifications **M** | Provider-specific semantics; plugin installer limitations; unintended disclosure | **3.** Generalises a working flow and reuses its events. |
| Built-in browser | **Feasible as a managed side window.** Dedicated DevHub Chrome profile, visible automation, explicit human takeover; embedded streaming later. | **L**; native Chromium embedding **XL** | Authenticated-session access; Windows/WSL boundary; takeover races and browser updates | **4.** Highest security/platform cost; can ship independently once run ownership exists. |

Effort: **S** bounded change; **M** several components; **L** multi-phase/platform work; **XL** substantial runtime/security work. Relative sizes, not delivery promises.

**Scope:** retain local files; no theme refresh, custom IDE, cookie extraction or replacement agent runtime. External facts are linked; compatibility, licences and prices need rechecking before distribution.

## 1. Editor and AI-on-selection

### Current state in the code (with file paths)

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

Proposed `dashboard/lib/editor/` owns editor lifecycle and selections. The extension sends `workspaceId, taskId?, runId?, relativePath, revision, ranges, selectedText, documentVersion, dirty`; the server validates the workspace and previews the exact context before sending it to Paseo. Unsaved text must be labelled, not silently replaced with disk contents.

| Platform | Placement |
| --- | --- |
| macOS | code-server runs beside the Node service; WKWebView displays its isolated loopback origin. Test workers, clipboard, shortcuts and authentication in the actual Tauri shell. |
| Windows/WSL2 | Editor server and extension host run in the selected distro, beside the repo on ext4. WebView2 connects through Windows→WSL localhost forwarding. Never treat a Windows path as a WSL path implicitly. |
| Linux | Same service-side editor, rendered by WebKitGTK; test distro webview versions and clipboard separately. |

Use `desktop/sidecar/supervisor.mjs` ownership patterns and `desktop/src-tauri/src/wsl.rs` path handling. Allocate an ephemeral loopback port, avoiding dashboard 1337, terminal 1339 and Paseo 6767. Start one editor lazily; check unsaved buffers before idle shutdown. Coder recommends at least [1 GB RAM and two CPU cores](https://coder.com/docs/code-server/requirements); this is a host recommendation, not measured incremental usage. Measure RSS/CPU for idle, indexing and two worktrees.

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

- Is reviewing and discussing code enough initially, or must the first release edit files?
- Which extensions/languages are essential, and is an optional editor download acceptable?
- Should a selection default to the implementing assistant or a separate explanation-only conversation?

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

- Is a second assistant mandatory, and should it re-review every must-fix resolution?
- Should commit and push share one approval, as in the demo, or be separate?
- Is strict isolation required for the first release, and should notifications continue after fully quitting DevHub?

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

### Open questions for John

- Is a managed side window sufficient initially, or must browsing appear inside DevHub?
- Which work sites need persistent login, and should work/personal profiles always be separate?
- Must browser tasks survive fully quitting DevHub, and what screenshot/download retention is acceptable?

## 4. Generic integrations, including chat

### Current state in the code (with file paths)

- `dashboard/lib/jira/client.ts` implements Jira REST, ADF, issue creation and transitions; `docs/integrations/jira.md` describes its configuration. `dashboard/lib/github/prs.ts` uses `dashboard/lib/gh-exec.ts`; GitHub login is the local `gh` session (`docs/integrations/github.md`).
- Coupling extends into `shared/tasks/types.ts` (`jiraKey`), `shared/entity-note/`, provider-specific routes and `dashboard/lib/tasks/task-pr-watch.ts`. Generic UI alone would not remove it.
- `docs/integrations/google-calendar.md`, `datadog.md` and `figma.md` show different auth/delivery models; do not force them through a single credential mechanism.
- Tier-2 plugins copy source through `dashboard/lib/plugins/materialize.ts`; `types.ts` and `db-materialize.ts` already support `DbConnectionProvider` imports.
- **The new installer is narrower:** `dashboard/lib/plugins/inspect.ts:427` blocks MCP servers, dashboard modules, overlays and branding; it currently enables skills/agents only. Source materialisation and installed-app runtime extensibility are separate capabilities.

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

Packaged builds initially ship approved adapters. Dynamic plugins need a separate reviewed, out-of-process protocol; the current installer cannot load them. An interface alone does not sandbox plugin code.

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

### Open questions for John

- Which second tracker/source-control provider should prove the abstraction, and is multi-account support needed immediately?
- Slack, Telegram or both first? Are generic work notifications allowed on personal messaging accounts?
- Is WhatsApp worth business onboarding and possible charges, and must provider plugins install into packaged DevHub without rebuilding?
