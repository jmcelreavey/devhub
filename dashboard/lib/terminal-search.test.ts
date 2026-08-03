import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionLogTail } from "@/lib/terminal-log";
import { getSessionTranscript, redactSecrets } from "@/lib/terminal-search";

/**
 * These are the tests that matter for R6. Search over shell transcripts is only
 * safe if the masking holds, so each case is a real shape that shows up in a
 * terminal log.
 */
describe("redactSecrets", () => {
  it.each([
    ["export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG", "wJalrXUtnFEMI"],
    ["DATABASE_PASSWORD=hunter2", "hunter2"],
    ["MY_API_KEY: abc123def456", "abc123def456"],
    ['GITHUB_TOKEN="ghp_aaaaaaaaaaaaaaaaaaaa"', "ghp_aaaa"],
    ["SESSION_KEY='s3cr3tvalue'", "s3cr3tvalue"],
  ])("masks the value in %s", (line, secret) => {
    const out = redactSecrets(line);
    expect(out).not.toContain(secret);
    expect(out).toContain("[redacted]");
  });

  it("keeps the key name so the result is still recognisable", () => {
    expect(redactSecrets("export AWS_SECRET_ACCESS_KEY=abcdef123456")).toBe(
      "export AWS_SECRET_ACCESS_KEY=[redacted]",
    );
  });

  it("masks Authorization headers", () => {
    expect(redactSecrets("Authorization: Bearer abcdef123456")).toBe("Authorization: [redacted]");
    expect(redactSecrets("authorization: Basic dXNlcjpwYXNz")).toBe("authorization: [redacted]");
  });

  it.each([
    ["ghp_abcdefghijklmnopqrstuvwxyz012345", "[redacted-github-token]"],
    ["sk-abcdefghijklmnopqrstuvwxyz", "[redacted-api-key]"],
    ["xoxb" + "-1111111111-abcdefghijkl", "[redacted-slack-token]"],
    ["AKIA" + "IOSFODNN7EXAMPLE", "[redacted-aws-key-id]"],
    ["AIzaSyA1234567890abcdefghijklmnopqrs", "[redacted-google-key]"],
  ])("recognises %s by shape alone", (token, marker) => {
    expect(redactSecrets(`some output ${token} trailing`)).toContain(marker);
  });

  it("masks a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactSecrets(`token=${jwt}`)).not.toContain("dozjgNryP4J3");
  });

  it("masks credentials embedded in a URL but keeps the host", () => {
    const out = redactSecrets("psql postgres://admin:supersecret@db.example.com:5432/app");
    expect(out).not.toContain("supersecret");
    expect(out).toContain("db.example.com");
  });

  it("masks inline CLI secret flags", () => {
    expect(redactSecrets("mysql --password=hunter2 -u root")).not.toContain("hunter2");
    expect(redactSecrets("cli login --token abcdef123456")).not.toContain("abcdef123456");
  });

  it("masks a PEM private key block", () => {
    const pem = "-----BEGIN " + "RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(pem)).toBe("[redacted-private-key]");
  });

  it("leaves ordinary command lines completely alone", () => {
    // Over-eager masking that ate normal output would make search useless.
    for (const line of [
      "npm run build",
      "git commit -m 'fix the thing'",
      "cd /Users/example/Developer/devhub && ls -la",
      "curl https://api.example.com/health",
      "Compiled successfully in 86s",
    ]) {
      expect(redactSecrets(line)).toBe(line);
    }
  });

  it("masks every secret on a line with more than one", () => {
    const out = redactSecrets("API_KEY=aaaa111122223333 and TOKEN=bbbb444455556666");
    expect(out).not.toContain("aaaa111122223333");
    expect(out).not.toContain("bbbb444455556666");
  });

  it("is idempotent", () => {
    const once = redactSecrets("PASSWORD=hunter2");
    expect(redactSecrets(once)).toBe(once);
  });
});

describe("getSessionTranscript / readSessionLogTail", () => {
  const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  let dir: string;
  let prev: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-term-"));
    prev = process.env.DEVHUB_TERMINAL_LOG_DIR;
    process.env.DEVHUB_TERMINAL_LOG_DIR = dir;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.DEVHUB_TERMINAL_LOG_DIR;
    else process.env.DEVHUB_TERMINAL_LOG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for a missing session", () => {
    expect(getSessionTranscript(SESSION)).toBeNull();
    expect(readSessionLogTail(SESSION)).toBeNull();
  });

  it("returns redacted lines with stable 1-based indexes", () => {
    const file = path.join(dir, `${SESSION}.log`);
    const secret = "wJalrXUtnFEMI";
    fs.writeFileSync(file, `hello world\nexport AWS_SECRET_ACCESS_KEY=${secret}\nbye\n`, "utf8");
    const raw = readSessionLogTail(SESSION);
    expect(raw).not.toBeNull();
    expect(raw!.lines[0]).toBe("hello world");
    expect(raw!.lines[1]).toContain(secret);

    const view = getSessionTranscript(SESSION);
    expect(view).not.toBeNull();
    expect(view!.lines[0]).toBe("hello world");
    expect(view!.lines[1]).not.toContain(secret);
    expect(view!.lines[1]).toContain("[redacted]");
    expect(view!.lines[2]).toBe("bye");
  });
});
