import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectSkills, scanLocalSkillImportCandidates } from "./collect-skills";

describe("scanLocalSkillImportCandidates", () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  it("lists skills with SKILL.md under tool dirs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-repo-"));
    process.env.HOME = tmp;
    fs.mkdirSync(path.join(tmp, ".codex/skills/zeta-skill"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".codex/skills/zeta-skill/SKILL.md"), "# z\n");
    fs.mkdirSync(path.join(repo, "skills/shared"), { recursive: true });

    const c = scanLocalSkillImportCandidates(repo);
    const z = c.find((x) => x.name === "zeta-skill");
    expect(z).toBeDefined();
    expect(z!.alreadyInRepo).toBe(false);
    expect(z!.status).toBe("new");
    expect(z!.sources.some((s) => s.tool === "codex")).toBe(true);
    expect(z!.kind).toBe("skill");
  });

  it("classifies local newer skills and explicit import updates the repo copy", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-repo-"));
    process.env.HOME = tmp;

    const repoSkill = path.join(repo, "skills/shared/example");
    const localSkill = path.join(tmp, ".codex/skills/example");
    fs.mkdirSync(repoSkill, { recursive: true });
    fs.mkdirSync(localSkill, { recursive: true });
    const repoFile = path.join(repoSkill, "SKILL.md");
    const localFile = path.join(localSkill, "SKILL.md");
    fs.writeFileSync(repoFile, "# repo\n");
    fs.writeFileSync(localFile, "# local\n");
    fs.utimesSync(repoFile, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    fs.utimesSync(localFile, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

    const candidate = scanLocalSkillImportCandidates(repo).find((x) => x.name === "example");
    expect(candidate?.status).toBe("local-newer");

    const code = await collectSkills({
      repoRoot: repo,
      emit: () => {},
      importSkillNames: ["example"],
    });

    expect(code).toBe(0);
    expect(fs.readFileSync(repoFile, "utf-8")).toBe("# local\n");
  });

  it("does not overwrite a repo-newer skill during explicit import", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-repo-"));
    process.env.HOME = tmp;

    const repoSkill = path.join(repo, "skills/shared/example");
    const localSkill = path.join(tmp, ".codex/skills/example");
    fs.mkdirSync(repoSkill, { recursive: true });
    fs.mkdirSync(localSkill, { recursive: true });
    const repoFile = path.join(repoSkill, "SKILL.md");
    const localFile = path.join(localSkill, "SKILL.md");
    fs.writeFileSync(repoFile, "# repo\n");
    fs.writeFileSync(localFile, "# local\n");
    fs.utimesSync(localFile, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    fs.utimesSync(repoFile, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

    const candidate = scanLocalSkillImportCandidates(repo).find((x) => x.name === "example");
    expect(candidate?.status).toBe("repo-newer");

    const code = await collectSkills({
      repoRoot: repo,
      emit: () => {},
      importSkillNames: ["example"],
    });

    expect(code).toBe(0);
    expect(fs.readFileSync(repoFile, "utf-8")).toBe("# repo\n");
  });
});
