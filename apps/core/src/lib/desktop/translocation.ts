/**
 * A Mac app opened from a DMG, or still in App Translocation, cannot replace
 * its own bundle. The path is the current executable (the bundled Node, or
 * the Rust shell).
 */
export function isTranslocatedAppPath(exePath: string): boolean {
  const norm = exePath.replaceAll("\\", "/");
  if (norm.includes("/AppTranslocation/")) return true;
  const volume = /\/Volumes\/([^/]+)\//.exec(norm);
  if (!volume) return false;
  if (volume[1] === "Macintosh HD") return false;
  return norm.includes(".app/");
}
