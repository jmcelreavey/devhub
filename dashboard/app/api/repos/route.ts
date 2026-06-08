import { NextResponse } from "next/server";
import { formatPathWithTilde, getReposScanDir, listRepos } from "@/lib/repos";
import { withErrorHandler } from "@/lib/api-utils";

export const GET = withErrorHandler(async () => {
  const repos = await listRepos();
  const scanDirDisplay = formatPathWithTilde(getReposScanDir());
  return NextResponse.json({ repos, scanDirDisplay });
}, "repos");
