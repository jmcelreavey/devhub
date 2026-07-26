# Tauri migration + onboarding overhaul — implementation plan

*The active plan. A full Rust rewrite was costed and rejected — see the appendix at
the bottom for why. This is the cheap path that fixes more of the real problem.*

---

## The order matters

**Onboarding first, Tauri second.** That's deliberate and it's the opposite of the
instinct.

Tauri is the more interesting engineering problem, so it's tempting to lead with it.
But shipping a beautifully packaged installer for an app that then demands a Google
Cloud project and a `gh auth login` just moves the wall six seconds later. Onboarding
work also has no dependency on the shell, so it ships value continuously; Tauri is
one big cutover that's worth doing once the thing being packaged is actually
installable-and-usable by someone who isn't you.

---

# Phase 1 — Onboarding — **DONE except hosted OAuth**

## 1.1 Make dependencies detected, not assumed — **DONE**

Today the app assumes `git`, `gh`, Docker and cloud CLIs exist. When they don't, you
get a failed subprocess and a stack trace in a run log.

**Shipped:** `lib/setup/dependencies.ts`, `GET /api/setup/dependencies`, and a Tools
step in the wizard listing each tool with its version and what it unlocks.

Two defects it caught immediately, both invisible on inspection: a GUI-launched Node
process doesn't inherit the shell PATH, so `claude` at `~/.local/bin` reported as
missing (the app would have told the user to install something they already had); and
`kubectl version --output=yaml` reports its version as `clientVersion:`, a YAML
header.

Required vs optional is the important distinction and it doesn't currently exist:
`git` is genuinely required; `gh`, Docker, AWS CLI and `kubectl` gate *specific
features* and should degrade rather than break.

**Surface:** a Setup step listing each tool with status and a copyable install
command. Not a wall of red — "3 of 8 available; here's what each unlocks".

**Test:** the probe layer is pure over a `which`-style lookup, so it unit-tests
without a real machine.

## 1.2 Progressive disclosure: work with zero repos (~3 days — partly exists)

`/repos` assumes 52 checkouts; `/prs` assumes GitHub auth; `/ops` assumes AWS. A new
user sees a dashboard of empty and broken panels, which reads as "this is broken"
rather than "this isn't set up yet".

**Already there:** `SetupGateStatus` + `filterNavBySetup` in `lib/nav.ts` already gate
nav items on integration status, so the hard part is done.

**Remaining:** extend the gate to cover *tool* prerequisites (not just integrations)
using the new dependency report, and add the single "more features available"
affordance so hidden sections are discoverable rather than simply absent.

This reuses the route-usage instrumentation already added (R12): the same registry
of routes can carry prerequisites.

## 1.3 Google Calendar — **BYO path DONE; hosted OAuth still open**

**Done:** the OAuth flow itself was never missing - it works and always has. What was
missing was any way through the Google Cloud prerequisite without already knowing how.
That paragraph is now seven numbered steps, the redirect URI is computed from the real
origin with a copy button (rather than a hardcoded localhost example the user has to
translate), and the four common Google error codes get their specific fix instead of
the raw string.

**Still open, and deliberately deprioritised below Tauri.** Hosted OAuth would remove
the BYO-credentials requirement, but the trade is poor for this product:

- It buys back a **one-time ~10-minute setup** that is now properly guided.
- It costs **permanently**: Google app verification (weeks, plus annual re-review), a
  callback domain that must stay up forever, a hosted privacy policy and terms, and the
  awkwardness that a distributed "public" client cannot keep a secret.

For a tool whose stated constraint is *one machine, one developer*, that is all cost.
It only pays once DevHub is genuinely distributed to people who aren't you - which is
the same premise that justifies Tauri. But **Tauri pays even with one user** (200 MB →
15 MB, half the RAM, real signing and auto-update, every day), whereas hosted OAuth pays
once, briefly, per person.

**Revisit only if DevHub is actually shipped to other people.**

**Options, in order of preference:**

1. **Hosted OAuth callback.** A small static callback endpoint under a domain you
   control, with DevHub's own client ID shipped in the app. User clicks "Connect
   Google", approves, done. Requires app verification for the Calendar scope —
   allow several weeks of Google review, which is why this starts early.
2. **Device-code flow**, if the scope set permits it — no callback host needed.
3. **Keep BYO-credentials as an "advanced" path** for anyone who wants their own
   project.

**Note honestly:** this is the longest-lead item and the one with an external
dependency. Start it first even though it finishes last.

## 1.4 Rewrite the wizard as a conversation — **DONE**

The current `/setup` is a checklist of technical fields. Restructure to:

1. **What do you want to use DevHub for?** (repos / notes+tasks / ops / all) — this
   drives which later steps appear at all.
2. **Where's your code?** — a folder picker, with detection and a plain-language
   summary ("Found 52 git repositories").
3. **Connect accounts** — one button each, all skippable, each stating what it
   unlocks.
4. **Done** — land on a working page, not a settings screen.

**Rules for this rewrite:**
- Every step skippable; nothing blocks reaching a usable app.
- No field asks for something the app can detect.
- No jargon in labels. "PTY", "upstart", "backport", "materialise" and "vault" are
  all internal words that currently leak into the UI.

## 1.5 Plain-language pass — **DONE (smaller than expected)**

Done, and **much smaller than this plan assumed** - recorded because the estimate was
wrong, not because the work was skipped. Searching the UI for PTY / upstart /
materialise / vault returns ~600 hits, but almost all are identifiers and comments.
Exactly four reached a user's eyes, and all four are fixed.

"Upstart" is left alone: it is this project's name for a feature, like a product name,
and renaming it across 41 sites would be churn rather than clarity.

---

# Phase 2 — Tauri — **DONE** (2026-07-26)

Shipped. Electron has been removed; `desktop/` is the shell. See
[`docs/architecture/desktop-shell.md`](docs/architecture/desktop-shell.md) for
what was built and measured, and
[`docs/guides/desktop-development.md`](docs/guides/desktop-development.md) for
how to work on it.

**The size estimate below was wrong and is kept for honesty.** The measured
bundle is **243 MB**, against Electron's 266 MB — not ~15 MB. The reason is a
deliberate choice: shipping a known Node runtime (113 MB) rather than forcing
Next.js, `node-pty` and a real dependency graph through a single-executable
packager. Reliability over a smaller number on a download page. Revisit only
after GA, with measurements.

What the estimate got right: real code-signing, notarisation and auto-update,
and no bundled Chromium.

## 2.1 What actually changes

Next.js, React and all 147 API routes stay exactly as they are. Tauri replaces the
Electron shell: the OS webview instead of a bundled Chromium, plus a small Rust
binary that owns the window and the sidecar.

**Expected:** installer ~200 MB → ~15 MB; idle RAM roughly halved; real
code-signing, notarisation and auto-update.

**Measured:** 266 MB → 243 MB. Signing, notarisation and auto-update all
delivered. The bundle-size expectation was not met and should not have been
set without measuring the Node runtime first.

## 2.2 The one genuine architectural question

DevHub is a **Next server**, not a static site. It runs subprocesses, reads the
filesystem, holds a PTY. So the Next server must run as a **Tauri sidecar** — a
child process the Rust shell spawns, supervises and shuts down.

That means:

- Bundling Node, or compiling the server with `next build` + a Node single-executable
  application. **Verify this early** — it's the step most likely to be awkward, and
  everything else depends on it.
- Health-checking the sidecar before showing the window (the boot screen already
  exists and can cover this).
- Killing the sidecar reliably on quit, including on crash. Orphaned Node processes
  holding port 1337 would be a miserable first-run bug.

**Spike this in week 1 before committing to the rest.**

## 2.3 Sequence

| Step | Work | Est. |
|---|---|---|
| 1 | Sidecar spike: Next server as a supervised child, health check, clean shutdown | 1 week |
| 2 | Tauri shell: window, menus, deep links, single-instance guard | 1 week |
| 3 | Native file/folder pickers replacing typed paths (helps 1.4 too) | 3 days |
| 4 | Signing + notarisation (macOS), updater endpoint | 1 week |
| 5 | WebView compatibility pass | 3–5 days |
| 6 | Migration for existing installs — same config dirs, no data move | 2 days |

## 2.4 The WebView risk, named specifically

Tauri uses **WKWebView** on macOS, not Chromium. The components most likely to
differ are exactly the heavy ones: **BlockNote** (contenteditable behaviour differs
most between engines), **tldraw** (pointer events, canvas), **xterm** (font metrics
and clipboard), and **mermaid**.

**Mitigation:** the 28-spec Playwright suite already covers all 20 routes for render
+ console errors. Add a WebKit project to `playwright.config.ts` — Playwright ships
WebKit — and run the existing suite against it **before** committing to Tauri. That's
a day's work and it converts the biggest unknown into a measurement.

---

# Phase 3 — Optional Rust sidecars (1–2 weeks each, after Tauri)

Once the Rust process exists, hot paths can move into it *if measurement justifies
it*. Candidates, in order:

1. **Repo scanning** — 52 checkouts, currently a git subprocess each. `git2` in
   parallel is the clearest win and `/repos` is the slowest page.
2. **Terminal transcript search** — `lib/terminal-search.ts` is fine at current
   volumes; revisit if history grows.
3. **The PTY server** — `portable-pty` is a clean swap and removes the `node-pty`
   native-module build.

Each is independently shippable and reversible. **This is how you find out whether
Rust helps before betting a year on it.**

---

## Cost summary

| Phase | Estimate |
|---|---|
| 1 — Onboarding | 4–7 weeks |
| 2 — Tauri | 3–6 weeks |
| 3 — Rust sidecars (optional) | 1–2 weeks each |
| **Total to "installable and intuitive"** | **7–13 weeks** |

Against 9–18 months for the rewrite, for strictly more benefit on the stated goal.

---

## What I'd do in week 1

Three things in parallel, because each de-risks a different unknown and none blocks
the others:

1. **Start Google OAuth verification** — longest external lead time.
2. **Spike the Next-server-as-Tauri-sidecar** — the one genuine unknown in Phase 2.
3. **Add a WebKit project to Playwright and run the existing 28 specs** — one day,
   and it turns the largest Tauri risk into a number.

If the WebKit run comes back clean and the sidecar spike works, the rest is
execution rather than research.

## What would make me stop and rethink

- ~~**The sidecar spike fails or gets ugly.**~~ It did not. The supervisor is
  ~200 lines and shutdown is a process-group signal.
- ~~**WebKit breaks BlockNote or tldraw badly.**~~ Neither broke. Both are
  covered by WebKit journeys in CI. WebKit did find one real defect — the skip
  link was unreachable by keyboard — which Chromium never showed.
- **Google verification stalls.** Then 1.3 falls back to device-code or BYO
  credentials, and the wizard has to make that path as painless as possible instead.


---

# Appendix — why not a Rust rewrite

Recorded so the question doesn't get re-litigated from scratch.

**A full Rust rewrite costs 9-18 months and does not deliver the stated goal.**
Measured against the real codebase: 103,094 lines, 147 API routes, 1,158 tests, 28
runtime dependencies.

The decisive constraint is that **the UI cannot leave the browser**. BlockNote,
tldraw, mermaid, xterm and react-grid-layout have no Rust equivalents at any
reasonable cost, so "port to Rust" can only mean a Rust backend behind the same web
frontend - which *adds* a language and a build system rather than removing one.

The app is also I/O-bound, not CPU-bound: `/repos` is slow because it shells out to
git 52 times, and that costs the same in any language.

Of the seven frictions a non-developer actually hits - no installer, developer
vocabulary, required dev tooling, OAuth setup, a repos-shaped product, memory use,
slow cold start - a rewrite fixes **one and a half**, and they're the two least
likely to be complained about.

### The recommendation, and why

1. **Do the onboarding work** (#2). It is the literal answer to the question asked.
2. ~~**Move Electron → Tauri** (#1)~~ — done. Weeks, as estimated. Bundle size
   was the wrong reason to want it; process ownership, signing and safe
   auto-update were the real wins.
3. **Try one Rust sidecar** (#3) if you want to evaluate Rust on evidence.
4. **Don't rewrite.** 9–18 months, no feature progress, and it addresses one and a
   half of the seven real friction points.

The instinct behind the question is sound — the app *is* heavier than it should be,
and Electron *is* the reason. But that's a packaging problem with a packaging-shaped
fix, and it costs weeks rather than a year.

---


### What would change this advice

Being straight about the conditions under which the rewrite becomes right:

- **A hard memory or binary-size ceiling** (embedded, locked-down enterprise, a
  device target) that Tauri can't reach.
- **CPU-bound work becoming dominant** — local embeddings, indexing large corpora,
  real-time processing. Nothing in the current roadmap heads there.
- **Rust as a first-class team skill** where the maintenance cost inverts.
- **The product becoming genuinely headless** — a daemon with a thin UI. Then the
  browser-only dependencies stop being decisive and most of this analysis changes.

None of those hold today. If one starts to, revisit — and revisit with the sidecar
experiment (#3) already run, so the decision rests on measurement rather than
instinct.
