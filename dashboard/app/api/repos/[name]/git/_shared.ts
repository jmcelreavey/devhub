import { NextResponse } from "next/server";
import { resolveScannedRepo } from "@/lib/scanned-repo";

export type RepoParams = { params: Promise<{ name: string }> };

export function withScannedRepo(
  name: string,
): { ok: true; repoRoot: string } | { ok: false; response: NextResponse } {
  const repoRoot = resolveScannedRepo(name);
  if (!repoRoot) {
    return { ok: false, response: NextResponse.json({ error: "Unknown repo" }, { status: 404 }) };
  }
  return { ok: true, repoRoot };
}

export function gitFail(result: { stderr: string; stdout: string }, fallback: string) {
  return NextResponse.json(
    { error: result.stderr.trim() || result.stdout.trim() || fallback },
    { status: 500 },
  );
}
