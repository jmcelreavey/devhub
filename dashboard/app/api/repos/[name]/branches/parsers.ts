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
      const [hash = "", subject = ""] = head.split("\0");
      return {
        hash,
        subject,
        files: files.filter(Boolean).slice(0, 10),
      };
    });
}
