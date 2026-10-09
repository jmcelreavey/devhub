/** Match Next's hostname flags so management never trusts a different listener. */
export function listenerHost(args: string[], fallback: string): string {
  let host = fallback;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-H" || args[i] === "--hostname") host = args[++i] ?? "";
    else if (args[i].startsWith("--hostname=")) host = args[i].slice("--hostname=".length);
    else if (args[i].startsWith("-H")) host = args[i].slice(2);
  }
  return host;
}
