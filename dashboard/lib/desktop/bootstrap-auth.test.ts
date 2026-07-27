import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_COOKIE,
  DESKTOP_TOKEN_HEADER,
  isAllowedTerminalOrigin,
  isAuthenticatedDesktopRequest,
  isDesktopSession,
  isValidTerminalTicket,
  issueTerminalTicket,
  tokenMatches,
} from "./bootstrap-auth";

/**
 * These tests are the security boundary between a web page and the user's
 * shell, so they are written as attacks rather than as happy paths. Each
 * negative case below is something that would actually be tried.
 */

const TOKEN = "a".repeat(64);
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.DEVHUB_BOOTSTRAP_TOKEN;
  process.env.DEVHUB_BOOTSTRAP_TOKEN = TOKEN;
});

afterEach(() => {
  if (saved === undefined) delete process.env.DEVHUB_BOOTSTRAP_TOKEN;
  else process.env.DEVHUB_BOOTSTRAP_TOKEN = saved;
});

/** Enough of a NextRequest for the auth helpers. */
function request(opts: { headers?: Record<string, string>; cookie?: string }) {
  const headers = new Map(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    cookies: {
      get: (name: string) =>
        name === DESKTOP_COOKIE && opts.cookie !== undefined ? { value: opts.cookie } : undefined,
    },
  } as unknown as Parameters<typeof isAuthenticatedDesktopRequest>[0];
}

describe("token comparison", () => {
  it("accepts the exact token", () => {
    expect(tokenMatches(TOKEN)).toBe(true);
  });

  it("rejects a correct prefix", () => {
    // The timing-attack shape: guess one character at a time.
    expect(tokenMatches(TOKEN.slice(0, 63))).toBe(false);
    expect(tokenMatches(TOKEN.slice(0, 1))).toBe(false);
  });

  it("rejects a longer string that starts with the token", () => {
    expect(tokenMatches(`${TOKEN}extra`)).toBe(false);
  });

  it("rejects empty, null, and undefined without throwing", () => {
    expect(tokenMatches("")).toBe(false);
    expect(tokenMatches(null)).toBe(false);
    expect(tokenMatches(undefined)).toBe(false);
  });

  it("rejects everything when no session token exists", () => {
    delete process.env.DEVHUB_BOOTSTRAP_TOKEN;
    expect(isDesktopSession()).toBe(false);
    expect(tokenMatches(TOKEN)).toBe(false);
    // A blank env var must not become a token that matches a blank guess.
    process.env.DEVHUB_BOOTSTRAP_TOKEN = "   ";
    expect(isDesktopSession()).toBe(false);
    expect(tokenMatches("   ")).toBe(false);
  });
});

describe("request authentication", () => {
  it("accepts the shell's header probe", () => {
    expect(isAuthenticatedDesktopRequest(request({ headers: { [DESKTOP_TOKEN_HEADER]: TOKEN } }))).toBe(
      true,
    );
  });

  it("accepts the bootstrap cookie", () => {
    expect(isAuthenticatedDesktopRequest(request({ cookie: TOKEN }))).toBe(true);
  });

  it("rejects a request with neither", () => {
    expect(isAuthenticatedDesktopRequest(request({}))).toBe(false);
  });

  it("rejects a wrong cookie value", () => {
    expect(isAuthenticatedDesktopRequest(request({ cookie: "b".repeat(64) }))).toBe(false);
  });

  it("rejects everything in browser mode", () => {
    // No shell means no token means the bridge routes must not exist.
    delete process.env.DEVHUB_BOOTSTRAP_TOKEN;
    expect(isAuthenticatedDesktopRequest(request({ cookie: TOKEN }))).toBe(false);
  });
});

describe("terminal origin", () => {
  it("accepts the dashboard's own origin", () => {
    expect(isAllowedTerminalOrigin("http://127.0.0.1:1337", 1337)).toBe(true);
    expect(isAllowedTerminalOrigin("http://localhost:1337", 1337)).toBe(true);
  });

  it("rejects a lookalike hostname", () => {
    // The prefix trap: these are ordinary internet domains.
    expect(isAllowedTerminalOrigin("http://127.0.0.1.evil.com", 1337)).toBe(false);
    expect(isAllowedTerminalOrigin("http://localhost.evil.com:1337", 1337)).toBe(false);
    expect(isAllowedTerminalOrigin("http://notlocalhost:1337", 1337)).toBe(false);
  });

  it("rejects another port on the same host", () => {
    // OpenChamber and OpenCode also listen on loopback; neither may open a PTY.
    expect(isAllowedTerminalOrigin("http://127.0.0.1:1338", 1337)).toBe(false);
    expect(isAllowedTerminalOrigin("http://127.0.0.1", 1337)).toBe(false);
  });

  it("rejects a missing or unparseable origin", () => {
    // A handshake with no Origin is a non-browser client — curl, a script, or
    // a native process. None of those are the dashboard.
    expect(isAllowedTerminalOrigin(null, 1337)).toBe(false);
    expect(isAllowedTerminalOrigin(undefined, 1337)).toBe(false);
    expect(isAllowedTerminalOrigin("", 1337)).toBe(false);
    expect(isAllowedTerminalOrigin("not a url", 1337)).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(isAllowedTerminalOrigin("file://", 1337)).toBe(false);
    expect(isAllowedTerminalOrigin("chrome-extension://abc", 1337)).toBe(false);
  });

  it("rejects a LAN origin even on the right port", () => {
    // LAN mode must never reach the terminal; it is not proxied for this reason.
    expect(isAllowedTerminalOrigin("http://192.168.1.20:1337", 1337)).toBe(false);
  });
});

describe("terminal ticket", () => {
  /**
   * The cookie could not be the credential here: WKWebView does not attach it
   * to a `ws://` handshake on a different port, which broke the terminal in the
   * shipped app. These guard the replacement, which is what now stands between
   * a web page and an interactive shell.
   */

  it("issues a ticket that validates", () => {
    const ticket = issueTerminalTicket();
    expect(ticket).toBeTruthy();
    expect(isValidTerminalTicket(ticket)).toBe(true);
  });

  it("is not the bootstrap token", () => {
    // Leaking a ticket — from a URL, a log — must not leak the credential that
    // guards every other bridge route.
    expect(issueTerminalTicket()).not.toBe(TOKEN);
  });

  it("rejects a forged ticket", () => {
    expect(isValidTerminalTicket("f".repeat(64))).toBe(false);
    expect(isValidTerminalTicket("")).toBe(false);
    expect(isValidTerminalTicket(null)).toBe(false);
    expect(isValidTerminalTicket(undefined)).toBe(false);
  });

  it("rejects a ticket minted under a different token", () => {
    // A previous launch's ticket, or another instance's. Each launch gets a
    // fresh token, so tickets must not survive across them.
    const other = issueTerminalTicket();
    process.env.DEVHUB_BOOTSTRAP_TOKEN = "b".repeat(64);
    expect(isValidTerminalTicket(other)).toBe(false);
  });

  it("expires", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
      const ticket = issueTerminalTicket();
      expect(isValidTerminalTicket(ticket)).toBe(true);

      // One window later it is still accepted — a connection starting as the
      // window rolls over must not fail at random.
      vi.setSystemTime(new Date("2026-07-26T12:00:31Z"));
      expect(isValidTerminalTicket(ticket)).toBe(true);

      // Well past, it is not.
      vi.setSystemTime(new Date("2026-07-26T12:05:00Z"));
      expect(isValidTerminalTicket(ticket)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("issues nothing in browser mode", () => {
    delete process.env.DEVHUB_BOOTSTRAP_TOKEN;
    expect(issueTerminalTicket()).toBeNull();
    expect(isValidTerminalTicket("anything")).toBe(false);
  });
});
