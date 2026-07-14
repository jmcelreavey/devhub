import { NextRequest, NextResponse } from "next/server";
import {
  startRun,
  getScriptCatalog,
  getAllowedScripts,
  type AllowedScript,
  type RunScriptOptions,
} from "@/lib/scripts-runner";
import { requireDashboardAuth } from "@/lib/api-utils";

export async function GET() {
  return NextResponse.json({ scripts: getAllowedScripts(), catalog: getScriptCatalog() });
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const {
    script,
    excludeSkills,
    skills,
    excludeAgents,
    agents,
    prune,
    commitMessage,
    importSkillNames: rawImportSkills,
    importAgentNames: rawImportAgents,
    excludeServers,
    servers,
    importServerNames: rawImportServers,
    importMcpTarget,
    personaTool,
    personaSources,
  } = body as {
    script: AllowedScript;
    excludeSkills?: string[];
    skills?: string[];
    excludeAgents?: string[];
    agents?: string[];
    prune?: boolean;
    commitMessage?: string;
    importSkillNames?: string[] | string;
    importAgentNames?: string[] | string;
    excludeServers?: string[];
    servers?: string[];
    importServerNames?: string[] | string;
    importMcpTarget?: "repo" | "personal";
    personaTool?: string;
    personaSources?: string[];
  };
  const skillSlug = /^[a-z0-9][a-z0-9_-]{0,62}$/;
  const serverSlug = /^[a-z0-9][a-z0-9._-]{0,62}$/i;
  const cleanExclude = excludeSkills?.map((s) => s.trim()).filter((s) => skillSlug.test(s));
  const cleanSkills = skills?.map((s) => s.trim()).filter((s) => skillSlug.test(s));
  const cleanExcludeAgents = excludeAgents?.map((s) => s.trim()).filter((s) => skillSlug.test(s));
  const cleanAgents = agents?.map((s) => s.trim()).filter((s) => skillSlug.test(s));
  const cleanExcludeServers = excludeServers?.map((s) => s.trim()).filter((s) => serverSlug.test(s));
  const cleanServers = servers?.map((s) => s.trim()).filter((s) => serverSlug.test(s));

  const parseImport = (raw: typeof rawImportSkills, pattern: RegExp): string[] | undefined => {
    let names: string[] | undefined;
    if (Array.isArray(raw)) {
      names = raw.map((s) => String(s).trim()).filter((s) => pattern.test(s));
    } else if (typeof raw === "string") {
      names = raw.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => pattern.test(s));
    }
    return names?.length ? names : undefined;
  };
  const importSkillNames = parseImport(rawImportSkills, skillSlug);
  const importAgentNames = parseImport(rawImportAgents, skillSlug);
  const importServerNames = parseImport(rawImportServers, serverSlug);

  const runOpts: RunScriptOptions = {};
  if (cleanExclude?.length) runOpts.excludeSkills = cleanExclude;
  if (cleanSkills?.length) runOpts.skills = cleanSkills;
  if (cleanExcludeAgents?.length) runOpts.excludeAgents = cleanExcludeAgents;
  if (cleanAgents?.length) runOpts.agents = cleanAgents;
  if (cleanExcludeServers?.length) runOpts.excludeServers = cleanExcludeServers;
  if (cleanServers?.length) runOpts.servers = cleanServers;
  if ((script === "sync_skills" || script === "sync_agents" || script === "sync_mcp_servers") && typeof prune === "boolean") {
    runOpts.prune = prune;
  }
  if (script === "commit_dirty_push" && typeof commitMessage === "string" && commitMessage.trim().length > 0) {
    runOpts.commitMessage = commitMessage.trim().slice(0, 180);
  }
  if (script === "collect_local_skills" && importSkillNames?.length) {
    runOpts.importSkillNames = importSkillNames;
  }
  if (script === "collect_local_agents" && importAgentNames?.length) {
    runOpts.importAgentNames = importAgentNames;
  }
  if (script === "collect_local_mcp_servers") {
    if (importServerNames?.length) runOpts.importServerNames = importServerNames;
    if (importMcpTarget === "personal" || importMcpTarget === "repo") {
      runOpts.importMcpTarget = importMcpTarget;
    }
  }
  if (script === "collect_local_persona") {
    if (typeof personaTool === "string" && /^[a-z][a-z0-9_-]{0,32}$/.test(personaTool)) {
      runOpts.personaTool = personaTool;
    }
    if (Array.isArray(personaSources)) {
      const allowed = new Set(["shared-persona", "identity"]);
      const cleaned = personaSources
        .filter((s): s is string => typeof s === "string")
        .filter((s) => allowed.has(s)) as ("shared-persona" | "identity")[];
      if (cleaned.length) runOpts.personaSources = cleaned;
    }
  }
  const finalOpts = Object.keys(runOpts).length ? runOpts : undefined;
  const result = startRun(script, finalOpts);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json(result, { status: 202 });
}
