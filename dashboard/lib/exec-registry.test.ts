import { afterEach, describe, expect, it } from "vitest";
import {
  beginExternalCall,
  endExternalCall,
  listInFlightCalls,
  listSlowCalls,
  redactArgs,
  resetExecRegistry,
} from "./exec-registry";

afterEach(() => resetExecRegistry());

describe("redactArgs", () => {
  /**
   * This output is rendered in a page and returned by an MCP tool, so a token
   * reaching it would be a real leak rather than cosmetic noise.
   */
  it("redacts token-shaped arguments", () => {
    expect(redactArgs(["api", "ghp_abcdefghijklmnop"])).toEqual(["api", "‹redacted›"]);
    expect(redactArgs(["--token=supersecret"])).toEqual(["--token=‹redacted›"]);
    expect(redactArgs(["--password=hunter2"])).toEqual(["--password=‹redacted›"]);
  });

  /**
   * The DB client hands `mongosh`/`psql` URIs that carry credentials inline —
   * an Atlas SigV4 URI embeds the whole STS session token. Keep the host,
   * because that is what makes a stuck query identifiable.
   */
  it("redacts credentials from database URIs but keeps the host", () => {
    expect(
      redactArgs([
        "mongodb+srv://AKIA123:sEcReT@www-pl-1.cwbkm.mongodb.net/insider?authMechanism=MONGODB-AWS",
      ]),
    ).toEqual(["mongodb+srv://‹redacted›@www-pl-1.cwbkm.mongodb.net/…"]);
    expect(redactArgs(["postgresql://usr_capi_read:tok@prd-capi.rds.amazonaws.com:5432/capi"])).toEqual([
      "postgresql://‹redacted›@prd-capi.rds.amazonaws.com:5432/…",
    ]);
  });

  it("redacts password-shaped env assignments passed as argv", () => {
    expect(redactArgs(["PGPASSWORD=iam-auth-token", "psql"])).toEqual([
      "PGPASSWORD=‹redacted›",
      "psql",
    ]);
  });

  it("leaves ordinary arguments intact", () => {
    expect(redactArgs(["status", "--porcelain", "-C", "/repos/atlas"])).toEqual([
      "status",
      "--porcelain",
      "-C",
      "/repos/atlas",
    ]);
  });
});

describe("exec registry", () => {
  it("reports a call as in flight until it ends", () => {
    const id = beginExternalCall({ file: "git", args: ["status"], timeoutMs: 1000 });
    expect(listInFlightCalls().map((c) => c.command)).toEqual(["git status"]);
    endExternalCall(id, { ok: true, timedOut: false });
    expect(listInFlightCalls()).toEqual([]);
  });

  /** A fast, successful call is noise; recording every one would bury the offenders. */
  it("does not record a fast successful call as slow", () => {
    const id = beginExternalCall({ file: "git", args: ["status"], timeoutMs: 1000 });
    endExternalCall(id, { ok: true, timedOut: false });
    expect(listSlowCalls()).toEqual([]);
  });

  it("always records a timeout, however short", () => {
    const id = beginExternalCall({ file: "gh", args: ["search"], timeoutMs: 1000 });
    endExternalCall(id, { ok: false, timedOut: true });
    expect(listSlowCalls().map((c) => [c.command, c.timedOut])).toEqual([["gh search", true]]);
  });
});
