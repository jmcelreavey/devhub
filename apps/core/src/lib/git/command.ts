import path from "node:path";

/** Unknown commands (including aliases) take the write lock. */
export function isReadOnlyCommand(args: readonly string[]): boolean {
  const [command, subcommand] = args;
  if (["status", "diff", "rev-parse", "rev-list", "log", "show", "ls-files", "ls-tree", "cat-file", "show-ref", "merge-base", "for-each-ref", "check-ref-format", "check-ignore", "ls-remote", "diff-tree", "blame", "archive", "version", "--version"].includes(command)) return true;
  if (command === "worktree") return subcommand === "list";
  if (command === "stash") return subcommand === "list" || subcommand === "show";
  if (command === "remote") return subcommand === "get-url" || subcommand === "-v" && args.length === 2 || subcommand === "show" && args.includes("-n");
  if (command === "config") return ["--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "-l", "get", "list"].includes(subcommand) || args.length === 2 && /^[\w-]+\./.test(subcommand);
  if (command === "tag") return ["--list", "-l"].includes(subcommand) && !args.slice(1).some((arg) => /^--(?:delete|force|annotate|sign)(?:=|$)|^-[^-]*[dfas]/.test(arg));
  if (command === "reflog") return !subcommand || subcommand === "show" || subcommand.startsWith("-");
  if (command === "symbolic-ref") return !args.includes("--delete") && !args.includes("-d") && args.slice(1).filter((arg) => !arg.startsWith("-")).length === 1;
  if (command === "branch") {
    const writeLong = /^--(?:delete|move|copy|force|edit-description|unset-upstream|set-upstream|set-upstream-to|track|create-reflog)(?:=|$)/;
    const writeShort = /^-[^-]*[dDmMcCftul]/;
    return !args.slice(1).some((arg) => writeLong.test(arg) || writeShort.test(arg) || arg === "-l") && args.slice(1).some((arg) => ["--show-current", "--list", "-a", "--all", "-r", "--remotes", "--contains", "--merged", "--no-merged"].includes(arg));
  }
  return false;
}

/** Resolve global Git options before classifying the subcommand or selecting its queue. */
export function gitMutationRoot(args: readonly string[], cwd = process.cwd(), env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  let root = path.resolve(cwd);
  let gitDir = env.GIT_DIR;
  let index = 0;
  while (index < args.length) {
    const argument = args[index];
    if (argument === "-C") { root = path.resolve(root, args[index + 1] || "."); index += 2; continue; }
    if (argument.startsWith("-C") && argument.length > 2) { root = path.resolve(root, argument.slice(2)); index++; continue; }
    if (argument === "--git-dir") { gitDir = path.resolve(root, args[index + 1] || "."); index += 2; continue; }
    if (argument.startsWith("--git-dir=")) { gitDir = path.resolve(root, argument.slice(10)); index++; continue; }
    if (["-c", "--config-env", "--namespace", "--work-tree"].includes(argument)) { index += 2; continue; }
    if (argument === "--version" || argument === "--help") return null;
    if (argument.startsWith("-")) { index++; continue; }
    break;
  }
  if (isReadOnlyCommand(args.slice(index))) return null;
  if (args[index] === "clone" && args.length > index + 2 && !args[args.length - 1].startsWith("-")) return path.resolve(root, args[args.length - 1]);
  return gitDir ? path.resolve(root, gitDir) : root;
}
