import { AsyncLocalStorage } from "node:async_hooks";

interface TaskDirectoryScope { root: string; directory: string }
const scope = new AsyncLocalStorage<TaskDirectoryScope>();

export function withTaskDirectory<T>(root: string, directory: string, work: () => T): T {
  return scope.run({ root, directory }, work);
}

export function scopedTaskDirectory(root: string): string | undefined {
  const current = scope.getStore();
  return current?.root === root ? current.directory : undefined;
}
