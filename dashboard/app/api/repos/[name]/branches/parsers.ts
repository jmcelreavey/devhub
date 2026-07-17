export function parseChangedFiles(stdout: string) {
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 20)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "changed",
      path: line.slice(3),
    }));
}

export function parseUnpushedCommits(stdout: string) {
  return stdout
    .split("\u001e")
    .filter((chunk) => chunk.trim())
    .slice(0, 10)
    .map((chunk) => {
      const [head = "", ...files] = chunk.trim().split("\n");
      const parts = head.split("\0");
      // Prefer `%H%x00%h%x00%s`; fall back to legacy `%h%x00%s`.
      const hash = parts.length >= 3 ? (parts[0] ?? "") : "";
      const shortHash = parts.length >= 3 ? (parts[1] ?? "") : (parts[0] ?? "");
      const subject = parts.length >= 3 ? (parts[2] ?? "") : (parts[1] ?? "");
      return {
        hash: hash || shortHash,
        shortHash: shortHash || hash.slice(0, 7),
        subject,
        files: files.filter(Boolean).slice(0, 10),
      };
    });
}

/** Parse `git rev-list --left-right --count A...B` → `{ left, right }`. */
export function parseLeftRightCount(stdout: string): { left: number; right: number } {
  const [leftRaw = "0", rightRaw = "0"] = stdout.trim().split(/\s+/);
  const left = Number(leftRaw);
  const right = Number(rightRaw);
  return {
    left: Number.isFinite(left) ? left : 0,
    right: Number.isFinite(right) ? right : 0,
  };
}
