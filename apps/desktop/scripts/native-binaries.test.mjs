import test from "node:test";
import assert from "node:assert/strict";

import {
  NATIVE_BINARY_PATTERN,
  binaryFormat,
  foreignBinaryReason,
  isMuslLinked,
} from "./native-binaries.mjs";

/**
 * These fixtures are synthesised rather than checked in.
 *
 * The case that matters — a musl-linked ELF — only ever appears on a Linux
 * machine running `npm ci`, so on a developer's Mac there is nothing real to
 * test against and the bug ships to CI. Only the first four bytes and the
 * `libc.musl-` dependency string are load-bearing, and both are cheap to fake.
 */
function elf({ musl = false } = {}) {
  const header = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
  const deps = Buffer.from(musl ? "libc.musl-x86_64.so.1\0" : "libc.so.6\0", "utf8");
  return Buffer.concat([header, Buffer.alloc(64), deps]);
}

const machO = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(32)]);
const pe = Buffer.concat([Buffer.from("MZ", "utf8"), Buffer.alloc(32)]);
const javascript = Buffer.from("module.exports = require('./fallback');\n", "utf8");

test("recognises each executable format by its magic number", () => {
  assert.equal(binaryFormat(elf()), "elf");
  assert.equal(binaryFormat(machO), "macho");
  assert.equal(binaryFormat(pe), "pe");
});

test("a .node file that is really JavaScript is not a native binary", () => {
  // Some packages ship a `.node`-named shim. Deleting one would break the
  // package for the platform it *is* meant to serve.
  assert.equal(binaryFormat(javascript), "other");
  assert.equal(foreignBinaryReason(javascript, "linux"), null);
});

test("musl detection keys on the dependency, not the filename", () => {
  assert.equal(isMuslLinked(elf({ musl: true })), true);
  assert.equal(isMuslLinked(elf()), false);
  // A Mach-O binary cannot be musl-linked no matter what it contains.
  assert.equal(isMuslLinked(machO), false);
});

test("a musl ELF is rejected from a glibc Linux bundle", () => {
  // The exact failure this exists to prevent: linuxdeploy cannot resolve
  // libc.musl-x86_64.so.1 and takes the whole release job down with it.
  assert.equal(foreignBinaryReason(elf({ musl: true }), "linux"), "musl");
  assert.equal(foreignBinaryReason(elf(), "linux"), null);
});

test("binaries for another operating system are rejected by format", () => {
  assert.equal(foreignBinaryReason(machO, "linux"), "macho");
  assert.equal(foreignBinaryReason(pe, "linux"), "pe");
  assert.equal(foreignBinaryReason(elf(), "darwin"), "elf");
  assert.equal(foreignBinaryReason(machO, "darwin"), null);
});

test("a musl ELF is left alone on macOS — it is only dead weight there", () => {
  // Reported as the wrong format, which is true and sufficient; the musl
  // distinction only changes anything on Linux.
  assert.equal(foreignBinaryReason(elf({ musl: true }), "darwin"), "elf");
});

test("the filename pattern covers versioned shared objects", () => {
  for (const name of ["sharp.node", "libvips.so", "libvips.so.42", "foo.dylib", "bar.dll"]) {
    assert.equal(NATIVE_BINARY_PATTERN.test(name), true, name);
  }
  for (const name of ["index.js", "package.json", "README.node.md"]) {
    assert.equal(NATIVE_BINARY_PATTERN.test(name), false, name);
  }
});

test("a truncated or empty file is not mistaken for a binary", () => {
  assert.equal(binaryFormat(Buffer.alloc(0)), "other");
  assert.equal(binaryFormat(Buffer.from([0x7f, 0x45])), "other");
});
