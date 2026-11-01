import path from "node:path";

/** Resolve a content directory from env or `REPO_ROOT/<segment>`. */
export function resolveContentDir(
  envKey: string,
  repoRoot: string,
  relativeSegment: string,
): string {
  const fromEnv = process.env[envKey];
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(path.resolve(repoRoot), relativeSegment);
}
