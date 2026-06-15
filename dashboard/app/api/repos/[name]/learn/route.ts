import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getReposScanDir } from "@/lib/repos";
import { buildRepoLearningProfile } from "@/lib/repo-learning";

type Params = { params: Promise<{ name: string }> };

function resolveRepoPath(name: string): string | null {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes("..")) return null;
  const scanDir = path.resolve(getReposScanDir());
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== scanDir) return null;
  if (!fs.existsSync(path.join(repoPath, ".git"))) return null;
  return repoPath;
}

export async function GET(_req: Request, { params }: Params) {
  const { name } = await params;
  const repoPath = resolveRepoPath(name);
  if (!repoPath) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  try {
    const profile = await buildRepoLearningProfile(repoPath);
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("[api:repos:learn]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
