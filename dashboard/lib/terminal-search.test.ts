import { describe, it, expect } from "vitest";
import { redactSecrets } from "@/lib/terminal-search";

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
