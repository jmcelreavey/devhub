import { describe, expect, it } from "vitest";
import { URL_MESSAGES, parseGitHubRepoUrl } from "./github-url";

function refusal(raw: string): string {
  const result = parseGitHubRepoUrl(raw);
  if (result.ok) throw new Error(`expected ${JSON.stringify(raw)} to be refused, got ${result.repo.url}`);
  return result.message;
}

describe("parseGitHubRepoUrl accepts", () => {
  it.each([
    ["https://github.com/acme/team-tools", "acme", "team-tools"],
    ["https://github.com/acme/team-tools/", "acme", "team-tools"],
    ["https://github.com/acme/team-tools.git", "acme", "team-tools"],
    ["  https://github.com/acme/team-tools  ", "acme", "team-tools"],
    ["HTTPS://GitHub.com/acme/team-tools", "acme", "team-tools"],
    ["https://github.com/Acme-Corp/devhub_tools.v2", "Acme-Corp", "devhub_tools.v2"],
    ["https://github.com/acme/.github", "acme", ".github"],
  ])("%s", (raw, owner, repo) => {
    const result = parseGitHubRepoUrl(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repo).toEqual({
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    });
  });
});

describe("parseGitHubRepoUrl refuses with the copy the form shows", () => {
  it("empty input", () => {
    expect(refusal("")).toBe(URL_MESSAGES.empty);
    expect(refusal("   ")).toBe("Paste a GitHub repository URL.");
  });

  it.each([
    "http://github.com/acme/team-tools",
    "git@github.com:acme/team-tools.git",
    "ssh://git@github.com/acme/team-tools",
    "git://github.com/acme/team-tools",
    "file:///tmp/team-tools",
    "ftp://github.com/acme/team-tools",
    "https://gitlab.com/acme/team-tools",
    "https://www.github.com/acme/team-tools",
    "https://github.com./acme/team-tools",
    "https://github.company.example/acme/team-tools",
    "https://github.com.evil.example/acme/team-tools",
    "https://evil.example\\@github.com/acme/team-tools",
    "https://github.com:8443/acme/team-tools",
    "https://github.com:443/acme/team-tools",
    "github.com/acme/team-tools",
    "acme/team-tools",
    "not a url",
    "https://github.com/acme/team-tools extra",
    "https://github.com/acme/team tools",
    "https://github.com/acme/\tteam-tools",
  ])("wrong scheme, host or port: %j", (raw) => {
    expect(refusal(raw)).toBe(URL_MESSAGES.hostOrScheme);
  });

  it.each([
    "https://github.com",
    "https://github.com/",
    "https://github.com/acme",
    "https://github.com/acme/",
    "https://github.com//acme/team-tools",
    "https://github.com/acme//team-tools",
    "https://github.com/acme/./team-tools",
    "https://github.com/./team-tools",
    "https://github.com/acme/team-tools.git.git",
    "https://github.com/-acme/team-tools",
    "https://github.com/acme--corp/team-tools",
    "https://github.com/acme/team$tools",
    "https://github.com/acme/..",
    "https://github.com/acme/%2e%2e",
    "https://github.com/acme%2Fteam-tools",
    "https://github.com/acme%5Cteam-tools",
    "https://github.com/acme/team%00tools",
    "https://github.com/acme/team-tools%2F..%2Fevil",
  ])("missing or malformed owner and repository: %j", (raw) => {
    expect(refusal(raw)).toBe(URL_MESSAGES.shape);
  });

  it.each([
    "https://token@github.com/acme/team-tools",
    "https://user:pass@github.com/acme/team-tools",
    "https://x-access-token:ghp_abc123@github.com/acme/team-tools",
    "https://@github.com/acme/team-tools",
  ])("embedded credentials: %j", (raw) => {
    expect(refusal(raw)).toBe(URL_MESSAGES.credentials);
  });

  it("does not echo the credential back in the message", () => {
    expect(refusal("https://x-access-token:ghp_abc123@github.com/acme/team-tools")).not.toContain("ghp_abc123");
  });

  it.each([
    "https://github.com/acme/team-tools/tree/main",
    "https://github.com/acme/team-tools/tree/main/skills",
    "https://github.com/acme/team-tools/blob/main/README.md",
    "https://github.com/acme/team-tools/issues/1",
    "https://github.com/acme/team-tools/pull/2",
    "https://github.com/acme/team-tools/archive/refs/heads/main.zip",
    "https://github.com/acme/team-tools/releases",
  ])("page paths: %j", (raw) => {
    expect(refusal(raw)).toBe(URL_MESSAGES.pagePath);
  });

  it.each([
    "https://github.com/acme/team-tools?tab=readme",
    "https://github.com/acme/team-tools#readme",
    "https://github.com/acme/team-tools/?ref=main",
    "https://github.com/acme/team-tools.git?x=%20",
  ])("query string or fragment: %j", (raw) => {
    expect(refusal(raw)).toBe(URL_MESSAGES.queryOrFragment);
  });

  it("control characters never reach a command line", () => {
    expect(refusal("https://github.com/acme/team-tools\n--upload-pack=touch /tmp/x")).toBe(URL_MESSAGES.hostOrScheme);
    expect(refusal("https://github.com/acme/team-tools\u0000")).toBe(URL_MESSAGES.hostOrScheme);
    expect(refusal("https://github.com/acme/team-tools\r\nHost: evil")).toBe(URL_MESSAGES.hostOrScheme);
  });

  it("an option-looking repository name stays a path segment, never an argument", () => {
    const result = parseGitHubRepoUrl("https://github.com/acme/-upload-pack");
    // Allowed by GitHub's naming rules; safe because the clone address always starts with https://.
    expect(result.ok && result.repo.cloneUrl.startsWith("https://")).toBe(true);
  });
});
