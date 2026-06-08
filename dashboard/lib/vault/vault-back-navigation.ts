const MAX_STACK = 24;

function stackKey(vaultId: string): string {
  return `devhub:${vaultId}:nav-stack`;
}

function readStack(vaultId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(stackKey(vaultId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeStack(vaultId: string, stack: string[]): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(stackKey(vaultId), JSON.stringify(stack.slice(-MAX_STACK)));
}

/** Record a vault page visit for in-vault back navigation. */
export function recordVaultNavigation(
  vaultId: string,
  pagePrefix: string,
  pathname: string,
): void {
  if (!pathname.startsWith(pagePrefix)) return;
  const stack = readStack(vaultId);
  if (stack[stack.length - 1] === pathname) return;
  stack.push(pathname);
  writeStack(vaultId, stack);
}

/**
 * Previous in-vault path, or null if the user should fall back to the index.
 * Pops the current pathname from the stack.
 */
export function resolveVaultBackTarget(
  vaultId: string,
  pagePrefix: string,
  pathname: string,
): string | null {
  const stack = readStack(vaultId).filter((p) => p.startsWith(pagePrefix));
  while (stack.length > 0 && stack[stack.length - 1] === pathname) {
    stack.pop();
  }
  writeStack(vaultId, stack);
  const prev = stack.pop();
  writeStack(vaultId, stack);
  if (prev && prev.startsWith(pagePrefix) && prev !== pathname) {
    return prev;
  }
  return null;
}
