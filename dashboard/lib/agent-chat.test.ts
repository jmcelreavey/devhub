import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flattenAgentChatMessages,
  injectKindForPropose,
  insertAgentComposer,
  parseAgentChatStore,
  readAgentPopoutSize,
  seedJobMessages,
  sendAgentChat,
  writeAgentPopoutSize,
  AgentChatError,
  isAbortError,
  isUserAbortedAsk,
} from "./agent-chat";
import {
  CURSOR_HEADLESS_FORBIDDEN_FLAGS,
  cursorAgentPrintArgs,
  isPackagedAppResourcePath,
  resolveHeadlessCliCwd,
} from "./ai/cli-runner";
import { formatGenerateError } from "./ai/generate";
import { canvasRegenFailureMessage } from "./briefing-canvas";
import { providerDisplayName } from "./agent-status";

describe("cursor-agent print flags", () => {
  it("passes --trust and never yolo/force/approve-mcps", () => {
    const args = cursorAgentPrintArgs("review this briefing", "cursor-grok-4.5-high");
    expect(args.slice(0, 5)).toEqual([
      "-p",
      "review this briefing",
      "--model",
      "cursor-grok-4.5-high",
      "--trust",
    ]);
    for (const flag of CURSOR_HEADLESS_FORBIDDEN_FLAGS) {
      expect(args).not.toContain(flag);
    }
  });

  it("streams so progress is observable rather than buffering to the end", () => {
    // Plain --print emits nothing until the whole reply is ready, which left
    // no way to distinguish a slow generation from a hung one.
    const args = cursorAgentPrintArgs("hi", "cursor-grok-4.5-high");
    expect(args).toContain("--stream-partial-output");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
  });
});

describe("headless CLI cwd", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  it("rejects the packaged app resource root", () => {
    const bundle = "/Applications/DevHub.app/Contents/Resources/server";
    expect(isPackagedAppResourcePath(bundle)).toBe(true);
    const home = tmp("dh-home-");
    const cwd = resolveHeadlessCliCwd({
      requestedCwd: bundle,
      checkoutRoot: null,
      notesDir: null,
      home,
      resourceRoot: bundle,
    });
    expect(cwd).toBe(path.resolve(home));
    expect(isPackagedAppResourcePath(cwd)).toBe(false);
  });

  it("prefers checkout, then notes, then home", () => {
    const home = tmp("dh-home-");
    const notes = tmp("dh-notes-");
    const checkout = tmp("dh-git-");
    expect(
      resolveHeadlessCliCwd({
        checkoutRoot: checkout,
        notesDir: notes,
        home,
        resourceRoot: "/Applications/DevHub.app/Contents/Resources",
      }),
    ).toBe(path.resolve(checkout));
    expect(
      resolveHeadlessCliCwd({
        checkoutRoot: null,
        notesDir: notes,
        home,
      }),
    ).toBe(path.resolve(notes));
  });
});

describe("formatGenerateError", () => {
  it("keeps the real CLI reason, clipped", () => {
    expect(formatGenerateError(new Error("Workspace Trust Required\n  --trust"))).toContain(
      "Workspace Trust Required",
    );
    expect(formatGenerateError(new Error("x".repeat(800))).length).toBeLessThanOrEqual(500);
  });
});

describe("canvasRegenFailureMessage", () => {
  it("surfaces the generation error instead of a vague retry", () => {
    expect(canvasRegenFailureMessage({ configured: true, error: "Workspace Trust Required" })).toBe(
      "Couldn't regenerate the layout: Workspace Trust Required",
    );
    expect(canvasRegenFailureMessage({ configured: true })).not.toMatch(/try again in a moment/i);
    expect(canvasRegenFailureMessage({ configured: false })).toMatch(/isn't configured/i);
  });
});

describe("agent chat helpers", () => {
  it("flattens a single user turn as the raw prompt", () => {
    expect(flattenAgentChatMessages([{ role: "user", content: "Review PR #123" }])).toEqual({
      prompt: "Review PR #123",
    });
  });

  it("keeps a transcript for follow-ups", () => {
    const flat = flattenAgentChatMessages([
      { role: "system", content: "Be terse." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Go on" },
    ]);
    expect(flat.system).toBe("Be terse.");
    expect(flat.prompt).toContain("User: Hi");
    expect(flat.prompt).toContain("Assistant: Hello");
    expect(flat.prompt).toContain("User: Go on");
  });

  it("seeds a visible job turn", () => {
    expect(seedJobMessages("Reviewing PR #123…")[0]?.content).toBe("Reviewing PR #123…");
  });

  it("routes MCP injects to shell, never agent chat tabs", () => {
    expect(injectKindForPropose({ kind: "agent", source: "mcp" })).toBe("shell");
    expect(injectKindForPropose({ kind: "review", source: "ui" })).toBe("shell");
    expect(injectKindForPropose({ kind: "upstart", source: "mcp" })).toBe("upstart");
    expect(injectKindForPropose({ kind: "agent", source: "agent-job" })).toBe("agent");
  });

  it("parses persisted chat history", () => {
    const store = parseAgentChatStore(
      JSON.stringify({
        "1": [{ id: "a", role: "user", content: "hi", createdAt: 1, payload: "full prompt", attachments: [{ name: "a.ts", kind: "text" }] }],
        bad: "nope",
      }),
    );
    expect(store["1"]?.[0]?.content).toBe("hi");
    expect(store["1"]?.[0]?.payload).toBe("full prompt");
    expect(store["1"]?.[0]?.attachments?.[0]?.name).toBe("a.ts");
    expect(store.bad).toBeUndefined();
  });

  it("sendAgentChat reads JSON replies and surfaces errors", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: "hello from cursor", provider: "cursor-cli" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const chunks: string[] = [];
    const result = await sendAgentChat({ messages: [{ role: "user", content: "hi" }] }, (d) =>
      chunks.push(d),
    );
    expect(result).toEqual({ text: "hello from cursor", provider: "cursor-cli" });
    expect(chunks).toEqual(["hello from cursor"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/chat",
      expect.objectContaining({ method: "POST" }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Cursor isn’t installed.", setupHint: "install" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(sendAgentChat({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      AgentChatError,
    );
    vi.unstubAllGlobals();
  });

  it("times out hung chat requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );
    await expect(
      sendAgentChat({ messages: [{ role: "user", content: "hi" }] }, undefined, undefined, 20),
    ).rejects.toMatchObject({ name: "AgentChatError", message: expect.stringMatching(/timed out/i) });
    vi.unstubAllGlobals();
  });

  it("rethrows user Stop as AbortError", async () => {
    const ac = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );
    const pending = sendAgentChat(
      { messages: [{ role: "user", content: "hi" }] },
      undefined,
      ac.signal,
      5_000,
    );
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    vi.unstubAllGlobals();
  });

  it("maps stray fetch abort to an error toast, not silence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 5);
          }),
      ),
    );
    await expect(
      sendAgentChat({ messages: [{ role: "user", content: "hi" }] }, undefined, undefined, 5_000),
    ).rejects.toMatchObject({ name: "AgentChatError", message: expect.stringMatching(/interrupted/i) });
    vi.unstubAllGlobals();
  });

  it("treats AbortError as user cancel only when that signal aborted", () => {
    const ac = new AbortController();
    const err = new DOMException("Aborted", "AbortError");
    expect(isAbortError(err)).toBe(true);
    expect(isUserAbortedAsk(err, ac.signal)).toBe(false);
    ac.abort();
    expect(isUserAbortedAsk(err, ac.signal)).toBe(true);
  });

  it("uses product names in chrome, not CLI binary names", () => {
    expect(providerDisplayName("cursor-cli")).toBe("Cursor");
    expect(providerDisplayName("chatgpt")).toBe("ChatGPT");
    expect(providerDisplayName("opencode")).toBe("OpenCode");
  });

  it("puts dropped terminal text in the composer without sending", () => {
    const events: unknown[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => {
        events.push((e as CustomEvent).type, (e as CustomEvent).detail);
        return true;
      },
    });
    insertAgentComposer({ tabId: 3, text: "ls\n" });
    expect(events).toEqual(["devhub:agent-composer-insert", { tabId: 3, text: "ls" }]);
    insertAgentComposer({ text: "   " });
    expect(events).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("remembers pop-out size in localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });
    expect(readAgentPopoutSize()).toBeNull();
    writeAgentPopoutSize({ w: 800, h: 600 });
    expect(readAgentPopoutSize()).toEqual({ w: 800, h: 600 });
    vi.unstubAllGlobals();
  });
});

describe("agent chat client modules stay browser-safe", () => {
  const files = [
    path.join(__dirname, "agent-chat.ts"),
    path.join(__dirname, "agent-job.ts"),
    path.join(__dirname, "agent-attach.ts"),
    path.join(__dirname, "terminal-prompt.ts"),
    path.join(__dirname, "terminal-blocks.ts"),
    path.join(__dirname, "../components/shell/AgentChatPanel.tsx"),
    path.join(__dirname, "../components/shell/AgentStatusStrip.tsx"),
    path.join(__dirname, "../components/shell/TerminalPromptBar.tsx"),
    path.join(__dirname, "../components/shell/TerminalBlockHistory.tsx"),
  ];

  it("do not import node:* or terminal-log", () => {
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/from ["']node:/);
      expect(src, file).not.toMatch(/require\(["']node:/);
      expect(src, file).not.toMatch(/from ["']@\/lib\/terminal-log["']/);
      expect(src, file).not.toMatch(/from ["']@\/lib\/ai\/cli-runner["']/);
    }
  });
});
