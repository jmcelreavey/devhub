import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateAiTextOptions, GenerateAiTextResult } from "@/lib/ai/generate";
import type { FeedbackComment, PrFeedback } from "./feedback";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));

const { mineRepoConventions, isMining, recentSoftCheck } = await import("./miner");
const { readConventions, updateConventions } = await import("./store");
const { saveConventionsPrefs } = await import("./prefs");
const { setRuleStatus } = await import("./edit");

const REPO = "acme/widgets";

function comment(id: string, over: Partial<FeedbackComment> = {}): FeedbackComment {
  return {
    id,
    url: `https://github.com/${REPO}/pull/1078#${id}`,
    author: "reviewer-a",
    isBot: false,
    association: "MEMBER",
    body: `our pattern: ${id} goes in its own file under src/offers`,
    // Relative, so the age cutoff never ages these out.
    at: new Date(Date.now() - 3 * 86_400_000 + Number(id.slice(-1)) * 60_000).toISOString(),
    kind: "inline",
    path: "src/offers/routes.js",
    resolved: true,
    ...over,
  };
}

function pr(comments: FeedbackComment[], number = 1078): PrFeedback {
  return {
    number,
    title: "Add offers",
    url: `https://github.com/${REPO}/pull/${number}`,
    state: "MERGED",
    author: "pr-author",
    updatedAt: "2026-10-05T12:00:00Z",
    comments,
  };
}

const reply = (rules: Record<string, unknown>[]) => JSON.stringify({ rules: rules.map((rule) => ({ decision: "accepted", decisionReason: "Explicit, durable repo guidance supported by the feedback.", ...rule })) });

function setup(feedback: PrFeedback[], generateText: string | (() => Promise<string>) = reply([])) {
  const fetchFeedback = vi.fn(async () => feedback);
  const fetchGuidance = vi.fn(async () => []);
  const generate = vi.fn<(opts: GenerateAiTextOptions) => Promise<GenerateAiTextResult>>(async () => ({
    text: typeof generateText === "string" ? generateText : await generateText(),
    provider: "cursor-cli",
  }));
  return { fetchFeedback, fetchGuidance, generate, deps: { fetchFeedback, fetchGuidance, generate } };
}

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-conv-miner-"));
});

afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("mineRepoConventions", () => {
  it("turns review comments into an automatically accepted rule with a run record", async () => {
    const t = setup(
      [pr([comment("c1"), comment("c2")])],
      reply([{ text: "Put each handler in its own file", category: "structure", evidence: [1, 2] }]),
    );
    const outcome = await mineRepoConventions(REPO, { trigger: "manual", deps: t.deps });

    expect(outcome.status).toBe("mined");
    const file = readConventions(REPO)!;
    expect(file.rules).toHaveLength(1);
    expect(file.rules[0]).toMatchObject({ status: "accepted", origin: "review", prs: [1078] });
    expect(file.minedPrs).toEqual({ "1078": expect.any(String) });
    expect(file.checkedAt).toBeTruthy();
    expect(file.runs[0]).toMatchObject({ ok: true, trigger: "manual", prsScanned: 1, comments: 2, added: 1, reinforced: 0, provider: "cursor-cli", model: "default" });
    expect(t.generate.mock.calls[0][0].prompt).toContain("[C1]");
    expect(t.generate.mock.calls[0][0]).toMatchObject({ prefer: undefined, model: undefined });
  });

  it("accepts a rule outright when the PR author acted on the comment, and says so in the run", async () => {
    const acted = comment("c1", { actedOn: true, resolved: true });
    const t = setup([pr([acted])], reply([{ text: "Put each handler in its own file", evidence: [1] }]));
    const outcome = await mineRepoConventions(REPO, { trigger: "review", deps: t.deps });
    expect(outcome.status).toBe("mined");
    const file = readConventions(REPO)!;
    expect(file.rules[0]).toMatchObject({ status: "accepted", automaticDecision: { status: "accepted" } });
    expect(file.runs[0]).toMatchObject({ added: 1, autoAccepted: 1 });
    expect(t.generate.mock.calls[0][0].prompt).toContain("(author resolved or confirmed the request)");
  });

  it("automatically rejects a candidate even when the author agreed", async () => {
    const t = setup([pr([comment("c1", { actedOn: true })])], reply([{ text: "Put each handler in its own file", evidence: [1], decision: "rejected", decisionReason: "This comment addresses one file, not a lasting convention." }]));
    await mineRepoConventions(REPO, { trigger: "review", deps: t.deps });
    const file = readConventions(REPO)!;
    expect(file.rules[0]).toMatchObject({ status: "rejected", automaticDecision: { status: "rejected" } });
    expect(file.runs[0]).toMatchObject({ autoAccepted: 0, autoRejected: 1 });
  });

  it("assesses existing suggestions without new PR feedback", async () => {
    await updateConventions(REPO, (file) => {
      file.rules.push({
        id: "r_legacy", text: "Put each handler in its own file", category: "structure",
        status: "suggested", origin: "review", prs: [1078],
        evidence: [{ kind: "review", label: "PR #1078", quote: "Our pattern is one handler per file." }],
        firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(),
      });
    });
    const t = setup([], reply([{ id: "r_legacy", text: "Put each handler in its own file", evidence: [] }]));
    expect((await mineRepoConventions(REPO, { trigger: "agent", deps: t.deps })).status).toBe("mined");
    expect(readConventions(REPO)!.rules[0]).toMatchObject({ status: "accepted", automaticDecision: { status: "accepted" } });
    expect(t.generate.mock.calls[0][0].prompt).toContain("Our pattern is one handler per file.");
    expect((await mineRepoConventions(REPO, { trigger: "agent", deps: t.deps })).status).toBe("up-to-date");
    expect(t.generate).toHaveBeenCalledTimes(1);
  });

  it("keeps suggestions unchanged when the model omits their decisions", async () => {
    await updateConventions(REPO, (file) => {
      file.rules.push({
        id: "r_legacy", text: "Put each handler in its own file", category: "structure",
        status: "suggested", origin: "review", prs: [1078], evidence: [],
        firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(),
      });
    });
    expect((await mineRepoConventions(REPO, { trigger: "agent", deps: setup([], reply([])).deps })).status).toBe("failed");
    expect(readConventions(REPO)!.rules[0].status).toBe("suggested");
    expect(readConventions(REPO)!.runs[0].error).toContain("did not assess");
  });

  it("does not call the model again when nothing has changed", async () => {
    const t = setup([pr([comment("c1")])], reply([{ text: "Put each handler in its own file", evidence: [1] }]));
    await mineRepoConventions(REPO, { trigger: "manual", deps: t.deps });
    const before = readConventions(REPO)!.checkedAt;

    await new Promise((r) => setTimeout(r, 5));
    const outcome = await mineRepoConventions(REPO, { trigger: "agent", deps: t.deps });

    expect(outcome.status).toBe("up-to-date");
    expect(t.generate).toHaveBeenCalledTimes(1);
    expect(readConventions(REPO)!.checkedAt).not.toBe(before);
    expect(readConventions(REPO)!.runs).toHaveLength(1);
  });

  it("re-reads a PR when a reviewer adds a comment, and reinforces the rule", async () => {
    const first = setup([pr([comment("c1")])], reply([{ text: "Put each handler in its own file", evidence: [1] }]));
    await mineRepoConventions(REPO, { trigger: "manual", deps: first.deps });
    const id = readConventions(REPO)!.rules[0].id;

    const second = setup([pr([comment("c1"), comment("c2")])], reply([{ id, text: "Put each handler in its own file", evidence: [2] }]));
    const outcome = await mineRepoConventions(REPO, { trigger: "review", deps: second.deps });

    expect(outcome.status).toBe("mined");
    const file = readConventions(REPO)!;
    expect(file.rules).toHaveLength(1);
    expect(file.rules[0].evidence).toHaveLength(2);
    expect(file.minedPrs).toEqual({ "1078": expect.any(String) });
    expect(file.runs[0]).toMatchObject({ added: 0, reinforced: 1, trigger: "review" });
    expect(second.generate.mock.calls[0][0].prompt).toContain(`[${id}]`);
  });

  it("reconsiders the same comment when the author acts on it later", async () => {
    const feedback = [pr([comment("c1", { actedOn: false })])];
    const t = setup(feedback, reply([{ text: "Put each handler in its own file", evidence: [1] }]));
    await mineRepoConventions(REPO, { trigger: "review", deps: t.deps });
    expect(readConventions(REPO)!.rules[0].status).toBe("accepted");

    feedback[0].comments[0].actedOn = true;
    const result = await mineRepoConventions(REPO, { trigger: "review", deps: t.deps });

    expect(result.status).toBe("mined");
    expect(readConventions(REPO)!.rules[0]).toMatchObject({
      status: "accepted", automaticDecision: { status: "accepted" }, evidence: [expect.objectContaining({ actedOn: true })],
    });
    expect(t.generate).toHaveBeenCalledTimes(2);
  });

  it("reconsiders edited feedback without needing an extra comment", async () => {
    const feedback = [pr([comment("c1")])];
    const t = setup(feedback);
    await mineRepoConventions(REPO, { trigger: "review", deps: t.deps });
    feedback[0].comments[0].body = "Our pattern is to group handlers by provider instead.";
    expect((await mineRepoConventions(REPO, { trigger: "review", deps: t.deps })).status).toBe("mined");
    expect(t.generate).toHaveBeenCalledTimes(2);
  });

  it("re-reads everything when forced", async () => {
    const t = setup([pr([comment("c1")])], reply([]));
    await mineRepoConventions(REPO, { trigger: "manual", deps: t.deps });
    await mineRepoConventions(REPO, { trigger: "manual", force: true, deps: t.deps });
    expect(t.generate).toHaveBeenCalledTimes(2);
  });

  it("records a failed model call and leaves the reviewed rules alone", async () => {
    const good = setup([pr([comment("c1")])], reply([{ text: "Put each handler in its own file", evidence: [1] }]));
    await mineRepoConventions(REPO, { trigger: "manual", deps: good.deps });
    await updateConventions(REPO, (f) => setRuleStatus(f, f.rules[0].id, "accepted"));

    const bad = setup([pr([comment("c1"), comment("c2")])], async () => {
      throw new Error("cursor-agent not found on PATH.");
    });
    const outcome = await mineRepoConventions(REPO, { trigger: "review", deps: bad.deps });

    expect(outcome.status).toBe("failed");
    const file = readConventions(REPO)!;
    expect(file.rules[0].status).toBe("accepted");
    expect(file.minedPrs).toEqual({ "1078": expect.any(String) });
    expect(file.runs[0]).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    expect(file.checkedAt).toBeTruthy();
  });

  it("fails the run, writing nothing, when the reply is not JSON rules", async () => {
    const t = setup([pr([comment("c1")])], "I could not find any rules, sorry.");
    const outcome = await mineRepoConventions(REPO, { trigger: "manual", deps: t.deps });
    expect(outcome.status).toBe("failed");
    const file = readConventions(REPO)!;
    expect(file.rules).toEqual([]);
    expect(file.minedPrs).toEqual({});
    expect(file.runs[0].error).toMatch(/Could not read/);
  });

  it("records a GitHub failure as a failed run instead of throwing", async () => {
    const outcome = await mineRepoConventions(REPO, {
      trigger: "manual",
      deps: {
        fetchFeedback: async () => {
          throw new Error("GitHub CLI auth is required.");
        },
        fetchGuidance: async () => [],
        generate: vi.fn(),
      },
    });
    expect(outcome.status).toBe("failed");
    expect(readConventions(REPO)!.runs[0]).toMatchObject({ ok: false, trigger: "manual" });
  });

  describe("keeps the vault free of files nobody asked for", () => {
    const failing = {
      fetchFeedback: async (): Promise<PrFeedback[]> => {
        throw new Error("Could not resolve to a Repository");
      },
      fetchGuidance: async () => [],
      generate: vi.fn(),
    };

    it("writes nothing when an automatic check finds nothing to learn, but remembers it for the throttle", async () => {
      const repo = "acme/quiet";
      const t = setup([], reply([]));
      expect((await mineRepoConventions(repo, { trigger: "agent", deps: t.deps })).status).toBe("up-to-date");
      expect(readConventions(repo)).toBeNull();
      expect(recentSoftCheck(repo)).toMatchObject({ failed: false });
      expect(t.generate).not.toHaveBeenCalled();
    });

    it("writes nothing when an automatic check can't even reach the repo", async () => {
      const repo = "acme/unreachable";
      expect((await mineRepoConventions(repo, { trigger: "review", deps: failing })).status).toBe("failed");
      expect(readConventions(repo)).toBeNull();
      expect(recentSoftCheck(repo)).toMatchObject({ failed: true });
    });

    it("does write when the person pressed the button, so the page can show what happened", async () => {
      const repo = "acme/typo";
      await mineRepoConventions(repo, { trigger: "manual", deps: failing });
      expect(readConventions(repo)!.runs[0]).toMatchObject({ ok: false, trigger: "manual" });
    });

    it("leaves a run behind when a manual refresh finds nothing, instead of an empty page", async () => {
      const repo = "acme/quiet-manual";
      await mineRepoConventions(repo, { trigger: "manual", deps: setup([], reply([])).deps });
      const file = readConventions(repo)!;
      expect(file.rules).toEqual([]);
      expect(file.runs[0]).toMatchObject({ ok: true, trigger: "manual", prsScanned: 0, added: 0 });
    });

    it("does write a failed run once the repo has been read — that's a repo with feedback worth mining", async () => {
      const repo = "acme/has-feedback";
      const t = setup([pr([comment("c1")])], async () => {
        throw new Error("model unavailable");
      });
      await mineRepoConventions(repo, { trigger: "review", deps: t.deps });
      expect(readConventions(repo)!.runs[0]).toMatchObject({ ok: false, trigger: "review" });
    });

    it("stops remembering once a real file exists", async () => {
      const repo = "acme/becomes-real";
      await mineRepoConventions(repo, { trigger: "agent", deps: setup([], reply([])).deps });
      expect(recentSoftCheck(repo)).toBeDefined();
      await mineRepoConventions(repo, { trigger: "manual", deps: setup([pr([comment("c1")])], reply([{ text: "Put each handler in its own file", evidence: [1] }])).deps });
      expect(recentSoftCheck(repo)).toBeUndefined();
      expect(readConventions(repo)!.rules).toHaveLength(1);
    });
  });

  it("keeps decisions made while the model was thinking", async () => {
    const first = setup([pr([comment("c1")])], reply([{ text: "Put each handler in its own file", evidence: [1] }]));
    await mineRepoConventions(REPO, { trigger: "manual", deps: first.deps });
    const id = readConventions(REPO)!.rules[0].id;

    const second = setup([pr([comment("c1"), comment("c2")])], async () => {
      await updateConventions(REPO, (f) => setRuleStatus(f, id, "rejected"));
      return reply([{ id, text: "Put each handler in its own file", evidence: [2] }]);
    });
    await mineRepoConventions(REPO, { trigger: "review", deps: second.deps });

    const file = readConventions(REPO)!;
    expect(file.rules[0].status).toBe("rejected");
    expect(file.rules[0].evidence).toHaveLength(1);
  });

  it("passes the configured provider and model to the generator", async () => {
    await saveConventionsPrefs({ provider: "opencode", model: "big-model" });
    const t = setup([pr([comment("c1")])], reply([]));
    await mineRepoConventions(REPO, { trigger: "manual", deps: t.deps });
    expect(t.generate.mock.calls[0][0]).toMatchObject({ prefer: "opencode", model: "big-model" });
    expect(readConventions(REPO)!.runs[0].model).toBe("big-model");
  });

  it("reads at most the configured number of PRs", async () => {
    await saveConventionsPrefs({ prLimit: 12 });
    const t = setup([], reply([]));
    await mineRepoConventions(REPO, { trigger: "manual", deps: t.deps });
    expect(t.fetchFeedback).toHaveBeenCalledWith(REPO, 12);
  });

  it("shares one run between concurrent callers for the same repo", async () => {
    const t = setup([pr([comment("c1")])], reply([]));
    const [a, b] = [mineRepoConventions(REPO, { trigger: "manual", deps: t.deps }), mineRepoConventions(REPO.toUpperCase(), { trigger: "review", deps: t.deps })];
    expect(isMining(REPO)).toBe(true);
    await Promise.all([a, b]);
    expect(t.fetchFeedback).toHaveBeenCalledTimes(1);
    expect(isMining(REPO)).toBe(false);
  });

  it("rejects something that is not a GitHub repo", async () => {
    await expect(mineRepoConventions("not a repo", { trigger: "manual" })).rejects.toThrow(/Not a GitHub repo/);
  });

  it("mines guidance docs even with no review feedback, once", async () => {
    const guidance = [{ path: "AGENTS.md", content: "Handlers live in src/offers." }];
    const generate = vi.fn<(opts: GenerateAiTextOptions) => Promise<GenerateAiTextResult>>(async () => ({
      text: reply([{ text: "Keep route handlers in src/offers", evidence: [], guidance: [1] }]),
      provider: "cursor-cli",
    }));
    const deps = { fetchFeedback: async () => [], fetchGuidance: async () => guidance, generate };

    await mineRepoConventions(REPO, { trigger: "manual", deps });
    expect(readConventions(REPO)!.rules[0]).toMatchObject({ origin: "guidance", status: "accepted" });

    const again = await mineRepoConventions(REPO, { trigger: "agent", deps });
    expect(again.status).toBe("up-to-date");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
