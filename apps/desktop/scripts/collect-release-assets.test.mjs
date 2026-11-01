import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planAssets } from "./collect-release-assets.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const collectScript = path.join(scriptsDir, "collect-release-assets.mjs");
const manifestScript = path.join(scriptsDir, "build-updater-manifest.mjs");

const ARM = "aarch64-apple-darwin/release/bundle";
const INTEL = "x86_64-apple-darwin/release/bundle";

function destOf(plan, src) {
  return plan.find((entry) => entry.src === src)?.dest;
}

test("gives the two macOS updater tarballs and signatures distinct arch names", () => {
  const files = [
    `${ARM}/macos/DevHub.app.tar.gz`,
    `${ARM}/macos/DevHub.app.tar.gz.sig`,
    `${INTEL}/macos/DevHub.app.tar.gz`,
    `${INTEL}/macos/DevHub.app.tar.gz.sig`,
  ];
  const plan = planAssets(files, "2.0.0");
  assert.deepEqual(
    plan.map((entry) => entry.dest),
    [
      "DevHub_2.0.0_aarch64.app.tar.gz",
      "DevHub_2.0.0_aarch64.app.tar.gz.sig",
      "DevHub_2.0.0_x64.app.tar.gz",
      "DevHub_2.0.0_x64.app.tar.gz.sig",
    ],
  );
});

test("leaves DMG, Linux and Windows names unchanged", () => {
  const files = [
    `${ARM}/dmg/DevHub_2.0.0_aarch64.dmg`,
    `${INTEL}/dmg/DevHub_2.0.0_x64.dmg`,
    "release/bundle/appimage/DevHub_2.0.0_amd64.AppImage",
    "release/bundle/appimage/DevHub_2.0.0_amd64.AppImage.sig",
    "release/bundle/deb/DevHub_2.0.0_amd64.deb",
    "x86_64-pc-windows-msvc/release/bundle/nsis/DevHub_2.0.0_x64-setup.exe",
    "x86_64-pc-windows-msvc/release/bundle/nsis/DevHub_2.0.0_x64-setup.exe.sig",
  ];
  const plan = planAssets(files, "2.0.0");
  for (const file of files) assert.equal(destOf(plan, file), path.basename(file));
});

test("leaves a tarball that already names its arch alone", () => {
  const plan = planAssets(["whatever/DevHub_2.0.0_aarch64.app.tar.gz"], "2.0.0");
  assert.equal(plan[0].dest, "DevHub_2.0.0_aarch64.app.tar.gz");
});

test("ignores files that are not release assets", () => {
  const plan = planAssets(
    [`${ARM}/macos/DevHub.app/Contents/Info.plist`, "release/DevHub", "notes.txt", `${ARM}/dmg/DevHub_2.0.0_aarch64.dmg`],
    "2.0.0",
  );
  assert.deepEqual(plan.map((entry) => entry.dest), ["DevHub_2.0.0_aarch64.dmg"]);
});

test("fails on a destination name collision", () => {
  assert.throws(
    () => planAssets(["a/DevHub_2.0.0_x64.dmg", "b/DevHub_2.0.0_x64.dmg"], "2.0.0"),
    /DevHub_2\.0\.0_x64\.dmg/,
  );
});

test("fails rather than guess the arch of an arch-less tarball", () => {
  assert.throws(() => planAssets(["macos/DevHub.app.tar.gz"], "2.0.0"), /Refusing to guess/);
  assert.throws(
    () => planAssets(["universal-apple-darwin/release/bundle/macos/DevHub.app.tar.gz.sig"], "2.0.0"),
    /Refusing to guess/,
  );
});

test("collects the merged four-artifact layout and produces a valid updater manifest", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-"));
  const artifacts = path.join(tmp, "artifacts");
  const dist = path.join(tmp, "dist");
  try {
    // Contents are unique per file so a mix-up shows in the signatures.
    const layout = [
      `${ARM}/dmg/DevHub_2.0.0_aarch64.dmg`,
      `${ARM}/macos/DevHub.app.tar.gz`,
      `${ARM}/macos/DevHub.app.tar.gz.sig`,
      `${INTEL}/dmg/DevHub_2.0.0_x64.dmg`,
      `${INTEL}/macos/DevHub.app.tar.gz`,
      `${INTEL}/macos/DevHub.app.tar.gz.sig`,
      "release/bundle/appimage/DevHub_2.0.0_amd64.AppImage",
      "release/bundle/appimage/DevHub_2.0.0_amd64.AppImage.sig",
      "release/bundle/deb/DevHub_2.0.0_amd64.deb",
      "x86_64-pc-windows-msvc/release/bundle/nsis/DevHub_2.0.0_x64-setup.exe",
      "x86_64-pc-windows-msvc/release/bundle/nsis/DevHub_2.0.0_x64-setup.exe.sig",
    ];
    for (const rel of layout) {
      const file = path.join(artifacts, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, rel.endsWith(".sig") ? `sig:${rel}\n` : `bin:${rel}`);
    }

    const env = { ...process.env, GITHUB_REPOSITORY: "jmcelreavey/devhub", GITHUB_REF_NAME: "v2.0.0" };
    const collected = spawnSync(process.execPath, [collectScript, artifacts, dist, "2.0.0"], { encoding: "utf8", env });
    assert.equal(collected.status, 0, collected.stderr);
    assert.match(collected.stdout, /-> DevHub_2\.0\.0_aarch64\.app\.tar\.gz\n/);

    const manifestRun = spawnSync(process.execPath, [manifestScript, dist, "2.0.0"], { encoding: "utf8", env });
    assert.equal(manifestRun.status, 0, manifestRun.stderr);

    const manifest = JSON.parse(fs.readFileSync(path.join(dist, "latest.json"), "utf8"));
    const url = (file) => `https://github.com/jmcelreavey/devhub/releases/download/v2.0.0/${file}`;
    assert.deepEqual(Object.keys(manifest.platforms).sort(), [
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "windows-x86_64",
    ]);
    assert.deepEqual(manifest.platforms["darwin-aarch64"], {
      signature: `sig:${ARM}/macos/DevHub.app.tar.gz.sig`,
      url: url("DevHub_2.0.0_aarch64.app.tar.gz"),
    });
    assert.deepEqual(manifest.platforms["darwin-x86_64"], {
      signature: `sig:${INTEL}/macos/DevHub.app.tar.gz.sig`,
      url: url("DevHub_2.0.0_x64.app.tar.gz"),
    });
    assert.deepEqual(manifest.platforms["linux-x86_64"], {
      signature: "sig:release/bundle/appimage/DevHub_2.0.0_amd64.AppImage.sig",
      url: url("DevHub_2.0.0_amd64.AppImage"),
    });
    assert.deepEqual(manifest.platforms["windows-x86_64"], {
      signature: "sig:x86_64-pc-windows-msvc/release/bundle/nsis/DevHub_2.0.0_x64-setup.exe.sig",
      url: url("DevHub_2.0.0_x64-setup.exe"),
    });

    // The softprops globs in release-desktop.yml (fail_on_unmatched_files).
    const names = fs.readdirSync(dist);
    for (const glob of [/\.dmg$/, /\.AppImage$/, /\.deb$/, /\.exe$/, /\.tar\.gz$/, /\.sig$/, /^latest\.json$/]) {
      assert.ok(
        names.some((name) => glob.test(name)),
        `no file in dist matches ${glob}`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI exits non-zero when nothing is collected", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-empty-"));
  try {
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(path.join(tmp, "src", "readme.txt"), "x");
    const result = spawnSync(process.execPath, [collectScript, path.join(tmp, "src"), path.join(tmp, "dist"), "2.0.0"], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No release assets/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
