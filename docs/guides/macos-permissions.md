---
title: macOS permissions
description: Why DevHub re-asks for macOS permissions, and how to grant them once and have it stick.
order: 12
icon: KeyRound
tags: [desktop, setup]
related:
  - getting-started/desktop-app
  - contributing/desktop-development
---

# macOS permissions

Opening DevHub, opening OpenChamber, opening a terminal, or running an agent
request can each raise a macOS permission dialog — Files & Folders, Local
Network, Automation. Granting them should be a one-time thing. If DevHub keeps
asking, the cause is almost always one of two signature problems, not the
grants themselves.

## Why macOS forgets

macOS records a TCC grant against an app's **code signature**, not its path.

| Cause | Effect | Fix |
| ----- | ------ | --- |
| The bundle's seal is broken | macOS sees a damaged app and re-asks on every launch | Re-sign the installed bundle |
| The bundle is ad-hoc signed | The requirement pins the cdhash, which changes on every build, so grants are forgotten each rebuild | Sign with a stable local certificate |

**The seal.** `Contents/Resources/server` and `Contents/Resources/services` are
sealed by the signature, and **View → Rebuild Dashboard** rewrites both inside
the installed app. Rebuild now re-signs afterwards; older builds did not, which
left `/Applications/DevHub.app` permanently failing verification:

```bash
codesign --verify --deep --strict /Applications/DevHub.app
# a sealed resource is missing or invalid
```

**The identity.** An ad-hoc signature has no certificate behind it, so its
designated requirement is the cdhash — a fresh one every build. Even a
perfectly sealed ad-hoc bundle is a *different app* to TCC after each rebuild.

## Grant them once

Run once per Mac, from a checkout:

```bash
npm run desktop:sign:identity   # one sudo prompt; creates "DevHub Local Signing"
npm run desktop:build
npm run desktop:install
```

`desktop:sign:identity` is the scripted form of Keychain Access → Certificate
Assistant → Create a Certificate → Code Signing, self-signed, marked Always
Trust. `codesign` only uses identities the system trusts for code signing, and
adding that trust is the one operation that needs elevation.

Already have an app installed and just want to repair its seal — quit DevHub
first, then:

```bash
npm run desktop:sign:installed
```

Then grant, in **System Settings → Privacy & Security**:

- **Full Disk Access** → add `/Applications/DevHub.app`
- **Local Network** → enable DevHub
- **Automation** → allow DevHub to control the editors it opens

Full Disk Access is the blunt instrument that covers the Desktop/Documents/
Downloads prompts in one go. Skip it and you get the individual folder dialogs
instead — that is a preference, not a bug.

## What about the sidecars?

Nothing to grant separately. The Next server, the terminal PTY, OpenCode,
OpenChamber and the agent CLIs are spawned as child processes of the app, so
macOS attributes their file and network access to DevHub — the *responsible
process* — and they are covered by DevHub's own grants.

The exception is anything launched as a **separate application**, which becomes
its own responsible process: OpenChamber Desktop, OpenCode Desktop, Claude and
ChatGPT opened from the launch menu each carry their own permissions.

## Verifying

```bash
codesign -dv /Applications/DevHub.app 2>&1 | grep -E 'Authority|Signature'
codesign --verify --deep --strict /Applications/DevHub.app && echo sealed
```

A healthy install prints `Authority=DevHub Local Signing` and nothing from the
verify. `Signature=adhoc` means grants will not survive the next rebuild.

## Distribution

None of this makes the app distributable. A locally signed bundle is still
rejected by Gatekeeper on any other Mac and cannot be notarised — that needs an
Apple Developer ID. Set `DEVHUB_SIGN_IDENTITY` to use one when you have it; it
takes precedence over the local certificate.
