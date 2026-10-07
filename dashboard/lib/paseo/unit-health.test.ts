import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { missingPaseoUnitBinary, unitExecBinary } from "./unit-health";

describe("unitExecBinary", () => {
  it("reads a quoted executable, including spaces and escapes", () => {
    expect(unitExecBinary('[Service]\nExecStart="/home/my user/node" "--x"\n')).toBe("/home/my user/node");
    expect(unitExecBinary('ExecStart="/a/100%%/node" "--x"')).toBe("/a/100%/node");
  });
  it("reads an unquoted executable and tolerates a unit without one", () => {
    expect(unitExecBinary("ExecStart=/usr/bin/node --x")).toBe("/usr/bin/node");
    expect(unitExecBinary("[Service]\nRestart=no")).toBeNull();
  });
});

describe.skipIf(process.platform !== "linux")("missingPaseoUnitBinary", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-unit-"));
    fs.mkdirSync(path.join(home, ".config", "systemd", "user"), { recursive: true });
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
  const writeUnit = (binary: string) =>
    fs.writeFileSync(path.join(home, ".config", "systemd", "user", "devhub-paseo.service"), `ExecStart="${binary}" "--foreground"\n`);

  it("reports an executable an update deleted", () => {
    const gone = path.join(home, "runtime", "old", "node");
    writeUnit(gone);
    expect(missingPaseoUnitBinary(home)).toBe(gone);
  });
  it("is quiet when the executable exists, or when no unit is registered", () => {
    expect(missingPaseoUnitBinary(home)).toBeNull();
    const node = path.join(home, "node");
    fs.writeFileSync(node, "#!/bin/sh\n", { mode: 0o755 });
    writeUnit(node);
    expect(missingPaseoUnitBinary(home)).toBeNull();
  });
});
