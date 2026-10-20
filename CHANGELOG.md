# Changelog

User-visible changes, newest first. Versioned sections describe the public releases; Unreleased, when present, is work that has not shipped yet.

## Unreleased

### Added

- Connect a Slack bot from Setup without a public URL. Ask for task status, Needs you, today's tasks or auto progress in one allowlisted channel, scoped to your active profile or `in personal`. Replies use Home's next actions and one Open in DevHub button. Tokens stay masked; setup, test delivery and read-only MCP status are covered by mocked Slack tests.

- Paste or drop an image into a note. Cmd+V of a screenshot or copied image, or dragging PNG, JPEG, GIF or WebP files in from Finder, inserts an image block at the cursor in the notes editor and the Notes overlay. Images are capped at 8 MB; anything else gets a toast and no empty block is left behind. They're stored by content hash in `~/.local/state/devhub/note-media`, not inside `notes/`, so the content sync doesn't commit them. Images already under `notes/**/assets` render as before.

### Fixed

- Starting a plan no longer says six agents are running when two are. Runs that ended without DevHub hearing about it (an agent closed or deleted in Paseo, an idle agent with no result, a start Paseo never acknowledged) used to sit in "needs attention" for good and use up the limit. DevHub now marks them finished when it reads them, on every check, at startup and again just before it refuses a start. If a start is still refused, the launch sheet lists which agents are holding the limit and lets you clear one DevHub can no longer follow. Clearing doesn't stop anything in Paseo.
- "Open in Jira" from a parent ticket chip (the ↥ key on My Tickets and task rows) does something again in the desktop app. It was calling `window.open`, which the webview drops silently, and it built the link from a build-time domain rather than your Jira's. Parent chips now carry the real browse URL and open through the system browser. "Open on GitHub" on repo cards, "Open gist" on Shared, and external links in the Links modal and entity chips had the same problem and are fixed too.

### Changed

- Relicence the public core from MIT to **AGPL-3.0-only**. `LICENSE` is the GNU AGPL v3 text, `package.json` and the selection extension declare `AGPL-3.0-only`, and the README licence section names the copyright and a commercial-contact path via Discussions.
- Home's My tasks list now puts Running / in-progress work right under Needs action (newest first), then Next / To do, so the collapsed preview shows what is actually moving.
- Storyboard uses the full content width. Columns grow to fill the window (272px minimum), and the board only scrolls horizontally when they no longer fit.
- A collapsed Morning briefing is one tight row. Today's weather (icon, now, condition, high and low) sits in the header next to the title instead of leaving a blank band underneath, and the card drops from 80px to 50px. The condition and then the range drop out as the card narrows, and nothing shows if there's no forecast.
- Moving a Jira ticket is one click again. The status chip changes straight away (spinner on the chip only), then a toast says "PTF-5106 moved to Done" with **Undo** and **Details**, and the "Action completed" dialog is gone. Your own click is the approval and still lands in Recent actions. Anything an agent, MCP tool or chat asks for keeps the review step, which now has one heading, the ticket, a From → To change and the account by name, with ids behind **Details**. It's quicker too: one Jira read instead of three, about 0.9 s down to 0.25 s against a fixture Jira with 120 ms per call. `jira_ticket_transition` and `jira_ticket_create` now say "Proposed, not applied" instead of claiming the change was made.

## 2.1.1 - 2026-10-11

### Fixed

- The packaged Browser page no longer dies on load with a 500. `playwright-core`'s `browsers.json` is staged with the app, and Playwright loads only when a session starts, so a failure returns JSON instead of an empty error.
- Header focus and layout. Pointer-opened menus no longer focus the first item and draw a thick ring straight away; keyboard focus uses one inset ring on the outer control. Tools stay inline when the bar has room, and an empty sync slot no longer leaves a gap.

### Changed

- Fit the top bar to laptop widths. It now follows its own width rather than the window's: section tabs fold into a dropdown, search and Focus shrink to icons, Profiles to an initial, and Notes, tasks and diagrams fold into a Panels button. Setup sits with appearance and profile, not in that menu. Nothing overlaps or clips from 900px up in Graphite Neon (Default) or Hollow (Halloween), and every control keeps a label, tooltip and a 32–36px target.
- The header reads as section, search, focus, panels, then preferences. The Panels button is an icon of the same weight as its neighbours, and it only appears when notes, tasks and diagrams no longer fit inline.

## 2.1.0 - 2026-10-11

![DevHub overview: your day, ticket-to-PR agents, Git, notes, diagrams, skills, plugins and approved integrations](https://raw.githubusercontent.com/jmcelreavey/devhub/main/docs/assets/demos/overview.gif)

Recorded with disposable fixture data. Provider replies are simulated; no messages, tickets or AI requests are sent.

### Added

- One shared **Appearance → Theme effects** section for every core theme: grouped switches, live mark/activity previews, task/merge samples and per-theme reset. Existing Graphite and Hollow choices stay intact; Hollow's cursor now has its own switch, with sound and scares still opt-in.
- Theme quality pass: Ember Dusk's hearth, Abyss's sonar, Tokyo Night's lantern and Porcelain Garden's folded leaf each have matching loaders, ambient treatments, feedback, celebrations and mouse followers. Porcelain Garden replaces Catppuccin's palette without changing its saved id. Light/dark text and controls have contrast tests; reduced motion keeps static treatments and stops moving effects.

- Telegram setup walkthrough and sanitised GIF, in-app help and server-side chat ID discovery that leaves updates unacknowledged and refuses active webhooks. Document bot/token setup, exact allowlists, webhook secrets, restricted HTTPS ingress and troubleshooting.
- Explicit Slack/Telegram test messages for saved alert destinations, with durable, consent-bound results and duplicate-safe request IDs. MCP can list destinations, send a test and read chat-command status; enabling and write approval remain human-controlled.
- Safe idle agent-worktree cleanup: keeps branches, removes clean `.devhub/checkouts` worktrees with no commits beyond `origin/main` after two idle days, and trims ignored dependency/build directories in kept worktrees after seven days. Checks tasks, runs, Paseo and process cwds, supports dry-run and logs freed space. Scheduled Jobs has a one-click Sunday 03:17 preset; no job is silently seeded.
- Release notes in the app: a once-per-version What's new panel after an update, reopen links in the version area, setup and command palette, and a full changelog. Desktop update prompts show incoming notes before installing; releases use the matching changelog section for GitHub and `latest.json`. The read-only `release_notes_read` MCP tool works without the dashboard.
- Graphite Neon (Default) workshop effects: neon edges, a measuring grid, ambient scan, Shift Dock loader, activity/hover feedback, task/merge celebrations and chart/empty-state arrivals. Individual Appearance switches, reduced-motion support and hidden-tab suspension.
- A soft lime mouse follower, **on by default**, that steps aside over editors, text fields, terminals and iframes. It decorates rather than replaces the native pointer.
- Managed task browser with a live view inside DevHub, separate Chrome profiles, explicit site consent, expiring agent leases and one-action approvals. Reviewed in-memory uploads/downloads are capped at 20 MiB and tied to their actual target/origin.
- Write-capable Jira/GitHub integrations with reviewed, expiring, single-use proposals; account/task links; allowlisted Slack and Telegram inbound commands; opt-in workflow alerts with durable delivery state. Unknown outcomes aren't automatically repeated.
- Code-selection discussions beside the diff, optional Cursor/VS Code pairing and the separately installed in-app code-server editor. Discussions keep their task link without replacing implementation Resume.
- Durable task checks, code fingerprints, independent reviews, publication decisions and unread events. Restart recovery reconciles linked conversations without rerunning uncertain commands.
- Generic portable-plugin action APIs through reviewed request workers: declared routes, opt-in streaming output, per-route deadlines and status reads. Each plugin owns its action validation, review tokens and execution policy; private plugins stay separate.
- Shared Matt Pocock skill adaptations for design interviews, reproducible debugging, standards/spec reviews and deeper module boundaries; red/green and agent-writing guidance in existing DevHub workflows.
- Guides and sanitised demos for workshop effects, resize, Browser, integration proposals, Telegram, editor Ask AI and persistent reviews. One new 2.1.0 overview; existing GIFs are retained.
- MCP toolsets for integration proposals, editor snapshots/discussions and generic reviewed plugin actions, plus durable task evidence/review tools. Integration confirmation and task publication decisions remain human-controlled.
- Refreshed the hidden easter egg.

### Fixed

- Pin Graphite Neon (Default) first and Hollow (Halloween) second in Appearance and the command palette; keep the remaining theme order stable.
- Hide the sidebar's What's new pill with its own X, including in the collapsed sidebar. Share the panel's per-version dismissal so it stays hidden until a new version arrives; keep release notes and the changelog available in Setup → About and the command palette.
- Make theme names self-explanatory: **Graphite Neon (Default)** describes DevHub's charcoal + lime default, and **Hollow (Halloween) 🎃** explains its automatic October switch. Appearance, command palette and the Halloween notice use the same names; saved `graphite` and `hollow` preferences are unchanged.
- Resize Today cards and floating panels from every edge and corner, with minimum-size and position constraints.
- Keep browser file approvals bound to the captured input/frame and response; stale targets require another request.
- Stop legacy Jira continuation when its write review is cancelled.

## 2.0.5 — 2026-10-10

- Fix Rust formatting so the desktop release can pass its formatting checks (`7217ee356`). No new feature release in this tag.

## 2.0.4 — 2026-10-09

- Replace the bottle mark with Shift Dock branding.
- Run reviewed portable plugin pages, APIs, stateless MCP contributions and branding without rebuilding the packaged dashboard. Review bundle/lockfile hashes and requested permissions before enabling a runtime.
- Use packaged Node/npm for managed agent setup without changing interactive terminal PATH.
- Keep task key chips and CI badges from overlapping at laptop widths.

Tag: `v2.0.4` (`c2ec6a6c3`). The range also includes the Mac 2.0.3 build-preparation commit; that commit message isn't the release boundary.

## 2.0.3 — 2026-10-09

- Make a clean-Mac first install explicit: avoid triggering Apple's Command Line Tools shim unexpectedly, explain Git/Node/Safe-Chain/Paseo prerequisites, and document Gatekeeper and disk-image recovery.
- Make setup/status copy account for tools and integrations that were never configured, and keep disabled labels readable.
- Resolve the ai-tools skills path at request time.
- Make plugin prerequisite tests work when CI has `gh` in `/usr/bin`.

Tag: `v2.0.3` (`fa99dc964`).

## 2.0.2 — 2026-10-09

- Add **Plugins → Add from GitHub**: inspect the repository and declared contributions before enabling anything.
- Harden plugin review, installation and management after design review, including failure/retry states and touch-only larger targets.

Tag: `v2.0.2` (`3ae042225`).

## 2.0.1 — 2026-10-09

- Don't treat a content-only sync as a dashboard rebuild.
- Identify a remote pre-receive rejection without running the authentication retry; keep useful hook/push output in the sync log.

Tag: `v2.0.1` (`09c04cc3f`).

## 2.0.0 — 2026-10-09

- First public desktop release: macOS Apple Silicon/Intel, Windows through WSL 2, and Linux installers, with guided setup that doesn't require a fork or Git to start.
- Local tasks, notes, repos, Git workspace, databases, optional integrations, coding agents, shared skills/persona and MCP workflows in one dashboard.
- Store each task once with start/end dates, migrating older day files; group Jira-backed tasks by parent.
- Add the seasonal Hollow theme with separate effects, creatures, scares and sound controls; scares/sound stay off by default.
- Improve desktop startup, port ownership messages, private-repo setup, checkout rebuild/fallback, per-profile run state, platform shortcuts and update feedback.
- Seal unsigned macOS installers with ad-hoc signatures, stabilise Intel DMG creation and Windows installer tests, and flatten release assets before publication.

Tag: `v2.0.0` (`7ff80e1a1`). Installer limitations and setup steps are in the [README](README.md) and [desktop guide](docs/getting-started/desktop-app.md).
