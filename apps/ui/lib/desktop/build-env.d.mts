export function cleanBuildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function npmCliCandidates(execPath: string): string[];
export function resolveNpmCli(execPath: string, existsSync: (path: string) => boolean): string | null;
export function npmShimScript(kind: "npm" | "npx"): string;
export function withNodeToolchain(env: NodeJS.ProcessEnv, execPath: string): NodeJS.ProcessEnv;
export function canonicalLockJson(value: unknown): string;
export function lockfilesMatchIgnoringLibc(beforeText: string, afterText: string): boolean;
export function shouldRestoreTsconfig(wasClean: boolean, afterPorcelain: string): boolean;
