import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectSkills, scanLocalSkillImportCandidates } from "@/lib/collect/skills";

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

  it("does not collect a root-level skill install back into skills/shared", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-repo-"));
    process.env.HOME = tmp;

    // A root-level install (skills/<name>), synced out to a tool dir like any catalog skill.
    fs.mkdirSync(path.join(repo, "skills/shared"), { recursive: true });
    fs.mkdirSync(path.join(repo, "skills/frontend-design"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/frontend-design/SKILL.md"), "# upstream\n");
    fs.mkdirSync(path.join(tmp, ".codex/skills/frontend-design"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".codex/skills/frontend-design/SKILL.md"), "# upstream\n");

    const lines: string[] = [];
    await collectSkills({ repoRoot: repo, emit: (l) => lines.push(l) });

    // make-public-seed drops root-level skills on purpose; a copy under shared/ would
    // duplicate the skill and publish it anyway.
    expect(fs.existsSync(path.join(repo, "skills/shared/frontend-design"))).toBe(false);
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

    // Skipping a repo-newer skill is expected, not an error.
    expect(code).toBe(0);
    expect(fs.readFileSync(repoFile, "utf-8")).toBe("# repo\n");
  });

  it("blocks vendor skills from being forked into skills/shared", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-repo-"));
    process.env.HOME = tmp;

    fs.mkdirSync(path.join(repo, "skills/shared"), { recursive: true });
    fs.mkdirSync(path.join(repo, "skills/vendor/project-graveyard"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/vendor/project-graveyard/SKILL.md"), "# vendor\n");
    fs.mkdirSync(path.join(tmp, ".codex/skills/project-graveyard"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".codex/skills/project-graveyard/SKILL.md"), "# vendor\n");

    const candidate = scanLocalSkillImportCandidates(repo).find((x) => x.name === "project-graveyard");
    expect(candidate?.blockedFromCatalog).toBe(true);
    expect(candidate?.alreadyInRepo).toBe(true);

    const code = await collectSkills({
      repoRoot: repo,
      emit: () => {},
      importSkillNames: ["project-graveyard"],
    });

    // Vendored skills are skipped on purpose — that is not a failure.
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(repo, "skills/shared/project-graveyard"))).toBe(false);
  });

  it("aligns a local-newer copy onto the prefixed catalog name", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-repo-"));
    process.env.HOME = tmp;

    const repoSkill = path.join(repo, "skills/shared/devhub-repo-ownership");
    const localSkill = path.join(tmp, ".codex/skills/repo-ownership");
    fs.mkdirSync(repoSkill, { recursive: true });
    fs.mkdirSync(localSkill, { recursive: true });
    fs.writeFileSync(path.join(repoSkill, "SKILL.md"), "# catalog\n");
    fs.writeFileSync(path.join(localSkill, "SKILL.md"), "# local\n");
    fs.utimesSync(path.join(repoSkill, "SKILL.md"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    fs.utimesSync(path.join(localSkill, "SKILL.md"), new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

    const candidate = scanLocalSkillImportCandidates(repo).find((x) => x.name === "repo-ownership");
    expect(candidate?.blockedFromCatalog).toBe(false);
    expect(candidate?.status).toBe("local-newer");

    const code = await collectSkills({
      repoRoot: repo,
      emit: () => {},
      importSkillNames: ["repo-ownership"],
    });

    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(repoSkill, "SKILL.md"), "utf-8")).toBe("# local\n");
    expect(fs.existsSync(path.join(repo, "skills/shared/repo-ownership"))).toBe(false);
  });

  it("marks a root-level third-party skill as already in catalog and not addable", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-repo-"));
    process.env.HOME = tmp;
    fs.mkdirSync(path.join(repo, "skills/shared"), { recursive: true });
    fs.mkdirSync(path.join(repo, "skills/frontend-design"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/frontend-design/SKILL.md"), "# upstream\n");
    fs.mkdirSync(path.join(tmp, ".codex/skills/frontend-design"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".codex/skills/frontend-design/SKILL.md"), "# upstream\n");

    const candidate = scanLocalSkillImportCandidates(repo).find((x) => x.name === "frontend-design");
    expect(candidate?.alreadyInRepo).toBe(true);
    expect(candidate?.blockedFromCatalog).toBe(true);
  });
});
