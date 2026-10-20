import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEntityRefMenuGroups } from "@/lib/entity-ref-menu";
import { configuredJiraDomain } from "@/lib/jira/env";
import {
  jiraBrowseUrl,
  jiraDomainBootstrapScript,
  resolveJiraBrowseDomain,
} from "@/lib/utils";

const ENV_KEYS = ["JIRA_DOMAIN", "NEXT_PUBLIC_JIRA_DOMAIN", "DEVHUB_ENV_FILE"] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = originalEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

describe("resolveJiraBrowseDomain", () => {
  it("uses the domain injected into the browser over the build-time placeholder", () => {
    expect(resolveJiraBrowseDomain({
      injected: "acme.atlassian.net",
      published: "your-domain.atlassian.net",
    })).toBe("acme.atlassian.net");
  });

  it("uses JIRA_DOMAIN when the public var was empty at build time", () => {
    expect(resolveJiraBrowseDomain({
      configured: "acme.atlassian.net",
      published: "",
    })).toBe("acme.atlassian.net");
  });

  it("rejects the placeholder and unsafe hosts", () => {
    expect(resolveJiraBrowseDomain({
      injected: "your-domain.atlassian.net",
      configured: "https://evil.example/browse",
      published: "not a host",
    })).toBe("");
  });
});

describe("jiraBrowseUrl", () => {
  it("builds an Atlassian browse URL from JIRA_DOMAIN", () => {
    delete process.env.NEXT_PUBLIC_JIRA_DOMAIN;
    process.env.JIRA_DOMAIN = "acme.atlassian.net";
    expect(jiraBrowseUrl("PTF-5195")).toBe("https://acme.atlassian.net/browse/PTF-5195");
  });

  it("does not send the browser to the placeholder domain", () => {
    delete process.env.JIRA_DOMAIN;
    process.env.NEXT_PUBLIC_JIRA_DOMAIN = "your-domain.atlassian.net";
    expect(jiraBrowseUrl("PTF-5195")).toBe("/api/jira/ticket/PTF-5195/redirect");
  });
});

describe("jiraDomainBootstrapScript", () => {
  it("embeds only a normalised hostname", () => {
    expect(jiraDomainBootstrapScript("Acme.atlassian.net"))
      .toBe('self.__DEVHUB_JIRA_DOMAIN="acme.atlassian.net";');
    const hostile = String.fromCharCode(34) + ";alert(1)//";
    expect(jiraDomainBootstrapScript(hostile)).toBe('self.__DEVHUB_JIRA_DOMAIN="";');
  });
});

describe("configuredJiraDomain", () => {
  it("reads JIRA_DOMAIN from the env file, not the placeholder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-jira-domain-"));
    const file = path.join(dir, ".env.local");
    fs.writeFileSync(file, "JIRA_DOMAIN=acme.atlassian.net\n");
    process.env.DEVHUB_ENV_FILE = file;
    delete process.env.JIRA_DOMAIN;
    delete process.env.NEXT_PUBLIC_JIRA_DOMAIN;
    expect(configuredJiraDomain()).toBe("acme.atlassian.net");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("Open in Jira menu", () => {
  it("replaces a stored placeholder browse URL", () => {
    delete process.env.NEXT_PUBLIC_JIRA_DOMAIN;
    process.env.JIRA_DOMAIN = "acme.atlassian.net";
    const opened: { href?: string }[] = [];
    const groups = buildEntityRefMenuGroups(
      {
        kind: "jira",
        id: "ptf-5195",
        label: "PTF-5195",
        href: "https://your-domain.atlassian.net/browse/PTF-5195",
      },
      { onOpen: (ref) => opened.push(ref), onCopy: () => {} },
    );
    const item = groups[0]?.items.find((entry) => entry.id === "open-jira");
    item?.onSelect();
    expect(opened[0]?.href).toBe("https://acme.atlassian.net/browse/PTF-5195");
  });
});
