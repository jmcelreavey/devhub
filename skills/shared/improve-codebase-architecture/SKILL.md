---
name: improve-codebase-architecture
description: >-
  Scan a codebase for shallow modules, present deepening options as an HTML
  report, then grill the one the user picks. Use when the user asks to
  improve the architecture, find deepening opportunities, or make a module
  easier to test and navigate.
metadata:
  short-description: Find shallow modules and deepen one
disable-model-invocation: true
---

# Improve codebase architecture

Surface architectural friction and propose deepening: a refactor that puts more behaviour behind a smaller interface. The aim is testability and a codebase an agent can navigate.

Use the words in [VOCABULARY.md](./VOCABULARY.md) exactly: module, interface, depth, seam, adapter, leverage, locality. Do not drift into component, service, API, or boundary.

`GLOSSARY.md` names the domain. ADRs in `docs/adr/` are decisions this pass does not re-litigate unless the friction is real enough to reopen one.

## 1. Explore

Deepening pays off where the code will change again. Scope before you scan.

- If the user named a module, subsystem, or pain point, start there.
- Otherwise walk `git log --oneline` and let the hot spots pull you. If the changes are scattered, widen the net.

Read the glossary and any ADRs in that area first.

Then walk the code and note where you feel friction:

- Understanding one concept means bouncing across many small modules.
- A module is shallow: the interface is nearly as complex as the implementation.
- Pure functions were extracted so they could be tested, and the real bugs hide in how they are called. No locality.
- Tightly coupled modules leak across their seams.
- A part is untested, or hard to test through its current interface.

Apply the deletion test. If deleting the module would make the complexity reappear across its callers, it was earning its keep. If the complexity just vanishes, it was a pass-through.

On DevHub, files materialised from a plugin (`dashboard/lib/team-ops.ts` and its neighbours) are copies. Do not propose deepening the copy. Name the plugin source.

Dependency categories and how the deepened module gets tested: [DEEPENING.md](./DEEPENING.md).

## 2. Present an HTML report

Write one self-contained HTML file in the OS temp directory: `$TMPDIR`, else `/tmp`, else `%TEMP%` on Windows. Path: `<tmpdir>/architecture-review-<timestamp>.html`. Open it (`open` on macOS, `xdg-open` on Linux, `start` on Windows) and tell the user the absolute path. Do not commit it.

Tailwind and Mermaid from CDNs. Each candidate is a card: files, problem, solution, benefits in locality and leverage, a before/after diagram, and a strength badge (`Strong`, `Worth exploring`, `Speculative`). End with the one candidate you would tackle first and why.

Use glossary words for the domain and the vocabulary file for the architecture. If the glossary defines Order, say "the Order intake module", not "the FooBarHandler" and not "the Order service".

If a candidate contradicts an ADR, include it only when the friction justifies reopening that ADR, and mark the card. Do not list every refactor an ADR forbids.

Scaffold, diagram patterns, and the words the report may use: [HTML-REPORT.md](./HTML-REPORT.md).

Do not propose interfaces yet. Ask which candidate they want to explore.

## 3. Grill the one they pick

Load `grill-with-docs` and walk the decision: constraints, what the deepened module is responsible for, what sits behind the seam, which tests survive.

As decisions settle:

- A new domain term: add it to `GLOSSARY.md` (and the task note, when there is one).
- A fuzzy term that just got sharp: update the glossary there and then.
- They reject the candidate for a reason a later review would need: offer an ADR. Skip "not now" and skip anything self-evident.
- They want alternative interfaces: follow [DESIGN-IT-TWICE.md](./DESIGN-IT-TWICE.md).

Do not start the refactor until they confirm the shared understanding. Implementation after that is a normal change: a DevHub task or the repo's usual branch, not a drive-by on `main`.

## Attribution

Adapted from Matt Pocock's `improve-codebase-architecture` and `codebase-design` skills (https://github.com/mattpocock/skills).

Copyright (c) 2026 Matt Pocock.

Permission is granted, free of charge, to anyone obtaining a copy of this material to deal in it without restriction, including the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies, provided this copyright notice and this permission notice appear in all copies or substantial portions. The material is provided as is, without warranty of any kind, express or implied.
