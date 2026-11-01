---
title: Testing
description: When DevHub code gets a test, when it doesn't, and how to keep the suite small.
order: 6
icon: FlaskConical
tags: [contributing, tests]
---

# Testing

Tests cost tokens and time to write, run and keep up to date. DevHub keeps a small suite that guards
the things a person can't check by looking at the app.

## Write a test when

- **Data could be lost or corrupted**: storage, migrations, sync, the notes vault, atomic writes,
  backup and recovery.
- **It's a security boundary**: dashboard auth, path validation, secrets, subprocess arguments,
  plugin permissions, anything that takes input from outside the machine.
- **A parser or schema handles awkward input**: markdown, frontmatter, manifests, config files.
- **A bug shipped and was hard to find**: one regression test at the public seam that saw it.

## Don't write a test for

- Rendering a component, or what a page says. Check UI in the browser instead.
- CSS, class names or source text read from a file.
- Route handlers that only pass mocks to other mocks.
- One-line mappings, labels, sorting helpers and anything the type checker already proves.
- A feature that's still changing shape.

## How

- One test at the public seam. Don't mock your own modules.
- Run the single test file while you work. Run the full suite once, before pushing.
- When a refactor breaks a test that pins implementation detail, delete the test. Fix it only when
  it guards something on the list above.
