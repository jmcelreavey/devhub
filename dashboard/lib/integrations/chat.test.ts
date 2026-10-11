import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./registry", () => ({ providerFor: () => ({ capabilities: ["pr.create"], accounts: () => [{ id: "default" }], prepareWrite: vi.fn(), executeWrite: vi.fn() }) }));
import { authenticateChat, handleChat } from "./chat";
import { listWrites } from "./write-store";

const now = Date.parse("2026-10-10T12:00:00Z"); const timestamp = String(now / 1000);
const secret = "example-test-secret-not-a-real-credential";
const rule = { user: "U1", channel: "C1", team: "T1", profile: "work", accounts: ["github:default"] };
const config = { enabled: true, secret, rules: [rule] };
const action = { action: "pr.create", provider: "github", account: "default", repo: "org/repo", head: "feature", base: "main", title: "Change", body: "Details" };
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "integration-chat-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function slack(text: string, fields: Record<string, string> = {}) {
  const raw = new URLSearchParams({ team_id: "T1", channel_id: "C1", user_id: "U1", command: "/devhub", text, ...fields }).toString();
  return { raw, headers: new Headers({ "x-slack-request-timestamp": timestamp, "x-slack-signature": "v0=" + createHmac("sha256", secret).update("v0:" + timestamp + ":" + raw).digest("hex") }) };
}
describe("inbound chat authentication and confirmation", () => {
  it("authenticates raw Slack bytes and binds exact workspace/channel/user/profile", () => {
    const s = slack("help");
    expect(authenticateChat("slack", s.headers, s.raw, "work", now, config).principal.user).toBe("U1");
    expect(() => authenticateChat("slack", s.headers, s.raw + "x", "work", now, config)).toThrow("signature");
    expect(() => authenticateChat("slack", s.headers, s.raw, "work", now + 301000, config)).toThrow("Expired");
    expect(() => authenticateChat("slack", s.headers, s.raw, "personal", now, config)).toThrow("allowed");
    for (const fields of [{ team_id: "T2" }, { channel_id: "C2" }, { user_id: "U2" }] as Record<string, string>[]) {
      const bad = slack("help", fields); expect(() => authenticateChat("slack", bad.headers, bad.raw, "work", now, config)).toThrow("allowed");
    }
    s.headers.set("origin", "https://attacker.test"); expect(() => authenticateChat("slack", s.headers, s.raw, "work", now, config)).toThrow("unauthorised");
  });
  it("accepts Telegram secret plus exact private sender/chat and rejects old/forwarded/group messages", () => {
    const telegram = { ...config, rules: [{ ...rule, user: "7", channel: "7" }] };
    const headers = new Headers({ "x-telegram-bot-api-secret-token": secret });
    const message = { date: now / 1000, text: "/devhub help", from: { id: 7, is_bot: false }, chat: { id: 7, type: "private" } };
    const raw = JSON.stringify({ update_id: 1, message });
    expect(authenticateChat("telegram", headers, raw, "work", now, telegram).text).toBe("help");
    expect(() => authenticateChat("telegram", new Headers(), raw, "work", now, telegram)).toThrow("secret");
    for (const change of [{ date: now / 1000 - 301 }, { forward_origin: {} }, { chat: { id: 7, type: "group" } }, { from: { id: 8, is_bot: false } }]) {
      expect(() => authenticateChat("telegram", headers, JSON.stringify({ update_id: 2, message: { ...message, ...change } }), "work", now, telegram)).toThrow();
    }
  });
  it("deduplicates across restart, creates only a proposal and cannot approve it", async () => {
    const s = slack("propose " + JSON.stringify(action)); const command = authenticateChat("slack", s.headers, s.raw, "work", now, config);
    const opts = { root, writeRoot: path.join(root, "writes"), now };
    const first = await handleChat(command, opts); const second = await handleChat(command, opts);
    expect(first.text).toContain("Nothing has been sent"); expect(second.duplicate).toBe(true);
    const records = listWrites("work", opts.writeRoot); expect(records).toHaveLength(1); expect(records[0].state).toBe("requested");
    const approve = slack("confirm " + records[0].id);
    expect((await handleChat(authenticateChat("slack", approve.headers, approve.raw, "work", now, config), opts)).text).toContain("cannot");
    expect(listWrites("work", opts.writeRoot)[0].state).toBe("requested");
  });
  it("limits accounts and refuses non-allowlisted senders before persisting", async () => {
    const s = slack("propose " + JSON.stringify({ ...action, account: "private" }));
    const command = authenticateChat("slack", s.headers, s.raw, "work", now, config);
    await expect(handleChat(command, { root, writeRoot: path.join(root, "writes"), now })).rejects.toThrow("account");
    expect(listWrites("work", path.join(root, "writes"))).toEqual([]);
  });
  it("rate-limits unique commands durably per sender", async () => {
    const opts = { root, writeRoot: path.join(root, "writes"), now };
    for (let i = 0; i < 10; i++) {
      const s = slack("help", { trigger_id: String(i) }); await handleChat(authenticateChat("slack", s.headers, s.raw, "work", now, config), opts);
    }
    const s = slack("help", { trigger_id: "11" });
    await expect(handleChat(authenticateChat("slack", s.headers, s.raw, "work", now, config), opts)).rejects.toMatchObject({ kind: "rate-limit" });
  });
});
