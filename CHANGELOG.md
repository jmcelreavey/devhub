# Changelog

User-visible changes, newest first. Versioned sections describe the public releases; Unreleased, when present, is work that has not shipped yet.

## Unreleased

### Changed

- Fit the top bar to laptop widths. It now follows its own width rather than the window's: section tabs fold into a dropdown, search and Focus shrink to icons, Profiles to an initial, and the Notes/Tasks/Diagrams buttons plus Setup move into a More menu. Recent pages return on wide screens. Nothing overlaps or clips from 900px up in Graphite Neon (Default) or Hollow (Halloween), and every control keeps a label, tooltip and a 32–36px target.
- Keep laptop navigation discoverable: give section tabs priority over secondary labels, retain labelled search and a stable Tools menu, remove recent-page breadcrumbs, and keep keyboard navigation and focus reliable as the bar resizes.

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
