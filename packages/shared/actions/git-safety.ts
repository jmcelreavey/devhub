export function isSafeRepoRelPath(filePath: string): boolean {
  if (!filePath || filePath.includes("\0")) return false;
  if (filePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(filePath)) return false;
  return !filePath.split(/[\\/]/).includes("..");
}
