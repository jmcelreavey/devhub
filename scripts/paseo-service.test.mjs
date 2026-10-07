import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PASEO_SYSTEMD_UNIT, buildDaemonPath, renderSystemdUnit, systemdPath, systemdQuote } from "./paseo-service.mjs";

test("quotes spaces, quotes, backslashes, % and $ so systemd reads them literally", () => {
  assert.equal(systemdQuote("/home/me/My Dir"), '"/home/me/My Dir"');
  assert.equal(systemdQuote('a"b'), '"a\\"b"');
  assert.equal(systemdQuote("a\\b"), '"a\\\\b"');
  assert.equal(systemdQuote("100%"), '"100%%"', "% would otherwise start a specifier");
  assert.equal(systemdQuote("$HOME"), '"$$HOME"', "$ would otherwise expand");
});

const sample = {
  root: "/home/me/.local/share/devhub/paseo",
  home: "/home/me/.local/share/devhub/paseo/home",
  args: ["/usr/bin/node", "--disable-warning=DEP0040", "/x/paseo", "daemon", "start", "--foreground", "--home", "/h", "--web-ui"],
  path: "/home/me/.nvm/bin:/usr/bin",
  log: "/home/me/.local/share/devhub/paseo/devhub.paseo.daemon.log",
};

test("renders a foreground daemon that restarts on failure only", () => {
  const unit = renderSystemdUnit(sample);
  assert.match(unit, /^\[Unit\]/);
  assert.match(unit, /ExecStart="\/usr\/bin\/node" "--disable-warning=DEP0040" "\/x\/paseo" "daemon" "start" "--foreground"/);
  assert.match(unit, /"--web-ui"\n/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /UMask=0077/);
  assert.match(unit, /Environment="PATH=\/home\/me\/\.nvm\/bin:\/usr\/bin"/);
  assert.match(unit, /Environment="PASEO_HOME=\/home\/me\/\.local\/share\/devhub\/paseo\/home"/);
  assert.match(unit, /WantedBy=default\.target/);
});

test("never backgrounds the daemon", () => {
  // A detached daemon breaks Cursor's ACP agent, and systemd would lose track of it.
  assert.doesNotMatch(renderSystemdUnit(sample), /Type=forking/);
});

test("the unit exports no npm prefix, so terminals it starts can load nvm", () => {
  const unit = renderSystemdUnit({ ...sample, npmPrefix: "/home/me/My Tools" });
  assert.doesNotMatch(unit, /npm_config_prefix/i);
});

test("daemon PATH keeps the user's order and demotes DevHub's own tooling", () => {
  const payloadRoot = "/home/me/.local/share/devhub/runtime";
  const path = buildDaemonPath({
    current: `/home/me/.local/share/devhub/tools/bin:/home/me/.nvm/bin:${payloadRoot}/abc/runtime:/usr/bin`,
    toolsBin: "/home/me/.local/share/devhub/tools/bin",
    nodeDir: "/home/me/.local/share/devhub/paseo/runtime",
    payloadRoot,
  });
  assert.equal(path, "/home/me/.nvm/bin:/usr/bin:/home/me/.local/share/devhub/tools/bin:/home/me/.local/share/devhub/paseo/runtime");
});

test("daemon PATH never lists a versioned payload, even as the node dir", () => {
  const payloadRoot = "/d/runtime";
  const path = buildDaemonPath({ current: "/usr/bin", toolsBin: "/d/tools/bin", nodeDir: `${payloadRoot}/abc/runtime`, payloadRoot });
  assert.equal(path, "/usr/bin:/d/tools/bin");
});

test("refuses to render without a command line", () => {
  assert.throws(() => renderSystemdUnit({ ...sample, args: [] }));
});

test("the unit name is stable", () => {
  assert.equal(PASEO_SYSTEMD_UNIT, "devhub-paseo.service");
});

test("whole-value paths are unquoted, because systemd does not strip quotes there", () => {
  const unit = renderSystemdUnit(sample);
  assert.match(unit, /^WorkingDirectory=\/home\/me\/\.local\/share\/devhub\/paseo$/m);
  assert.match(unit, /^StandardOutput=append:\/home\/me\//m);
  assert.equal(systemdPath("/a b/100%"), "/a b/100%%");
});

// The string checks above cannot catch a setting systemd rejects; the real
// verifier can. Skipped where systemd-analyze is absent (macOS, minimal CI).
const analyze = spawnSync("systemd-analyze", ["--version"], { encoding: "utf8" });
test("systemd accepts the unit, including a path with a space", { skip: analyze.status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo unit "));
  try {
    const bin = path.join(dir, "node");
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    const file = path.join(dir, PASEO_SYSTEMD_UNIT);
    fs.writeFileSync(file, renderSystemdUnit({ ...sample, root: dir, args: [bin, "--foreground"] }));
    const result = spawnSync("systemd-analyze", ["--user", "verify", file], { encoding: "utf8" });
    assert.doesNotMatch(result.stderr + result.stdout, /bad unit file|not absolute|fatal error|Invalid/i, result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
