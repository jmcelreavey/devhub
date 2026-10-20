import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dirs = vi.hoisted(() => ({ repoRoot: "" }));
vi.mock("@/lib/content/dirs", () => ({ getRepoRoot: () => dirs.repoRoot }));

const { resolveTypesafeApiKey, typesafeApiKey } = await import("./credentials");

const original = { file: process.env.DEVHUB_ENV_FILE, key: process.env.TYPESAFE_API_KEY };
let tmp: string;
const store = (line: string) => fs.writeFileSync(path.join(tmp, "config", ".env.local"), `${line}\n`);
const repoEnv = (line: string) => fs.writeFileSync(path.join(dirs.repoRoot, ".env"), `${line}\nOTHER_SECRET=nope\n`);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-qa-cred-"));
  fs.mkdirSync(path.join(tmp, "config"));
  fs.mkdirSync(path.join(tmp, "repo"));
  dirs.repoRoot = path.join(tmp, "repo");
  process.env.DEVHUB_ENV_FILE = path.join(tmp, "config", ".env.local");
  delete process.env.TYPESAFE_API_KEY;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [name, value] of [["DEVHUB_ENV_FILE", original.file], ["TYPESAFE_API_KEY", original.key]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("typesafeApiKey", () => {
  it("prefers the key saved in Setup over the environment and the repo .env", () => {
    store("TYPESAFE_API_KEY=apikey_from_setup_1234");
    process.env.TYPESAFE_API_KEY = "apikey_from_env_1234";
    repoEnv("TYPESAFE_API_KEY=apikey_from_repo_1234");
    expect(resolveTypesafeApiKey()).toEqual({ key: "apikey_from_setup_1234", source: "setup" });
  });

  it("falls back to the environment, then the repo .env", () => {
    process.env.TYPESAFE_API_KEY = " apikey_from_env_1234 ";
    repoEnv("TYPESAFE_API_KEY=apikey_from_repo_1234");
    expect(resolveTypesafeApiKey()).toEqual({ key: "apikey_from_env_1234", source: "env" });
    delete process.env.TYPESAFE_API_KEY;
    expect(resolveTypesafeApiKey()).toEqual({ key: "apikey_from_repo_1234", source: "repo-env" });
  });

  it("ignores blank values and reports nothing when no key exists anywhere", () => {
    store("TYPESAFE_API_KEY=   ");
    process.env.TYPESAFE_API_KEY = "";
    expect(resolveTypesafeApiKey()).toBeNull();
    expect(typesafeApiKey()).toBeUndefined();
  });
});
