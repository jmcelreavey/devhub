/**
 * Telling apart native binaries that belong in this bundle from ones that do not.
 *
 * npm packages with native code ship one prebuilt per target and let the
 * installer pick at runtime — `sharp` alone brings `@img/sharp-linux-x64`,
 * `@img/sharp-linuxmusl-x64`, `@img/sharp-darwin-arm64` and more. Next's tracer
 * cannot know which one the runtime will choose, so it traces all of them into
 * the standalone output.
 *
 * On macOS the extras are dead weight. On Linux they are a build failure:
 * linuxdeploy walks every ELF in the AppDir resolving dependencies, reaches the
 * musl-linked `sharp` prebuild, and stops with
 *
 *     ERROR: Could not find dependency: libc.musl-x86_64.so.1
 *     ERROR: Failed to deploy dependencies for existing files
 *
 * which Tauri reports only as "failed to run linuxdeploy". musl's libc is not
 * installed on a glibc system and never will be, so the binary could not have
 * run here anyway.
 *
 * Classification reads the file, not the package name. Naming for these
 * packages is inconsistent enough (`linuxmusl` in one, `linux-x64-musl` in
 * another) that a name list would rot quietly; a musl-linked ELF always records
 * `libc.musl-` as a needed library, and Mach-O always starts with one of four
 * known magic numbers.
 */

/** Filenames worth opening. Covers `libfoo.so.42` as well as `foo.so`. */
export const NATIVE_BINARY_PATTERN = /\.(node|so|dylib|dll)$|\.so\.\d/;

/** 32/64-bit Mach-O in both endiannesses, plus the fat-binary wrapper. */
const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

/**
 * `elf` / `macho` / `pe`, or `other` for anything that is not a native object —
 * a `.node` file can legitimately be a JavaScript shim.
 */
export function binaryFormat(buf) {
  if (!buf || buf.length < 4) return "other";
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return "elf";
  if (MACHO_MAGIC.has(buf.readUInt32BE(0))) return "macho";
  if (buf[0] === 0x4d && buf[1] === 0x5a) return "pe";
  return "other";
}

/** True when an ELF names musl's libc among its dependencies. */
export function isMuslLinked(buf) {
  return binaryFormat(buf) === "elf" && buf.includes("libc.musl-");
}

/**
 * Why this binary cannot run in a bundle for `platform`, or `null` if it can.
 *
 * Returns a reason string rather than a boolean so callers can say *what* was
 * wrong — "removed 3 binaries" is a much worse log line than naming musl.
 */
export function foreignBinaryReason(buf, platform) {
  const format = binaryFormat(buf);
  if (format === "other") return null;

  if (platform === "linux") {
    if (format !== "elf") return format;
    return isMuslLinked(buf) ? "musl" : null;
  }
  if (platform === "darwin") {
    return format === "macho" ? null : format;
  }
  if (platform === "win32") {
    return format === "pe" ? null : format;
  }
  return null;
}
