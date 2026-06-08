import { describe, it, expect } from "vitest";
import {
  canonicalizeAgentMarkdown,
  formatAgentForTool,
  parseAgentMarkdown,
} from "./agent-sync-format";

const CANONICAL = `---
name: ci-investigator
description: Investigate CI. Use when a PR check fails.
mode: subagent
readonly: true
---

You are a CI investigator.
`;

describe("formatAgentForTool", () => {
  it("emits OpenCode permission block without tools or readonly", () => {
    const out = formatAgentForTool(CANONICAL, "opencode");
    expect(out).toContain("mode: subagent");
    expect(out).toContain("permission:");
    expect(out).toContain("edit: deny");
    expect(out).toContain("bash: allow");
    expect(out).not.toContain("readonly:");
    expect(out).not.toContain("tools:");
    expect(out).toContain("You are a CI investigator.");
  });

  it("emits Cursor frontmatter with readonly", () => {
    const out = formatAgentForTool(CANONICAL, "cursor");
    expect(out).toContain("readonly: true");
    expect(out).toContain("is_background: false");
    expect(out).not.toContain("mode: subagent");
    expect(out).not.toContain("permission:");
    expect(out).not.toContain("tools:");
  });

  it("uses generic (Cursor-like) format for codex and claude", () => {
    const codex = formatAgentForTool(CANONICAL, "codex");
    expect(codex).toContain("readonly: true");
    expect(codex).not.toContain("permission:");
  });

  it("allows edit for writable agents on OpenCode", () => {
    const writable = CANONICAL.replace("readonly: true", "readonly: false");
    const out = formatAgentForTool(writable, "opencode");
    expect(out).toContain("edit: allow");
  });

  it("canonicalizes OpenCode permission layout to repo readonly", () => {
    const opencode = `---
description: Reviewer
mode: subagent
permission:
  edit: deny
  bash: allow
---

Review body.
`;
    const out = canonicalizeAgentMarkdown(opencode);
    expect(out).toContain("readonly: true");
    expect(out).not.toContain("permission:");
    expect(out).toContain("Review body.");
  });

  it("strips legacy tools block from source when formatting", () => {
    const legacy = `---
name: old
description: Legacy agent
mode: subagent
readonly: true
tools:
  write: false
  edit: false
  bash: true
---

Body
`;
    const out = formatAgentForTool(legacy, "opencode");
    expect(out).not.toContain("tools:");
    expect(parseAgentMarkdown(out)?.frontmatter.tools).toBeUndefined();
  });
});
