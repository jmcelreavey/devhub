#!/usr/bin/env node
/**
 * Create the stable local code-signing certificate, once per Mac.
 *
 * The problem it solves: macOS ties a TCC grant to the app's designated
 * requirement. For an ad-hoc signature that requirement pins the cdhash, and
 * the cdhash changes on every build — so Full Disk Access, Local Network and
 * Automation are re-requested after each `desktop:build`/`desktop:install`,
 * and again whenever `Rebuild Dashboard` rewrites the bundle. Signing with a
 * certificate makes the requirement "bundle id `com.devhub.launcher`, signed by
 * this certificate", which is stable across every rebuild on this machine.
 *
 * This is the scripted form of Keychain Access → Certificate Assistant →
 * Create a Certificate → Code Signing → self-signed, followed by marking it
 * "Always Trust". `codesign` will only use an identity the system trusts for
 * code signing, and adding that trust is an admin operation — hence the one
 * `sudo` prompt. Nothing else here needs elevation.
 *
 * Safe to re-run: it is a no-op once the identity exists.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { LOCAL_SIGNING_IDENTITY, hasLocalSigningIdentity } from "./codesign-bundle.mjs";

if (process.platform !== "darwin") {
  process.stdout.write("[identity] not macOS — nothing to do\n");
  process.exit(0);
}

function log(msg) {
  process.stdout.write(`[identity] ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed: ${detail || `exit ${res.status}`}`);
  }
  return res.stdout ?? "";
}

if (hasLocalSigningIdentity()) {
  log(`"${LOCAL_SIGNING_IDENTITY}" already exists — nothing to do`);
  process.exit(0);
}

const loginKeychain = run("security", ["default-keychain", "-d", "user"]).trim().replace(/^"|"$/g, "");

/**
 * Where the public certificate is written so the sudo trust step has a stable
 * path to point at. One fixed name, not a per-run temp file: the trust command
 * is often copied out and pasted into another terminal, and a path that has
 * already been cleaned up makes that fail for a reason nobody guesses.
 */
const EXPORTED_CERT_PATH = path.join(os.tmpdir(), "devhub-local-signing.pem");

/**
 * A certificate with our name already in the keychain but not showing up as a
 * valid signing identity means the import worked and only the trust setting is
 * missing — the half that needs sudo. Generating a second certificate in that
 * case would leave the keychain with a pile of near-identical entries and no
 * way to tell which one a bundle was signed with.
 */
function existingCertificatePath() {
  const res = spawnSync(
    "security",
    ["find-certificate", "-c", LOCAL_SIGNING_IDENTITY, "-p", loginKeychain],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (res.status !== 0 || !res.stdout?.includes("BEGIN CERTIFICATE")) return null;
  fs.writeFileSync(EXPORTED_CERT_PATH, res.stdout);
  return EXPORTED_CERT_PATH;
}

/** Trust the certificate for code signing. The one step that needs elevation. */
function trustForCodeSigning(certPath) {
  log("trusting it for code signing — macOS will ask for your password:");
  const trust = spawnSync(
    "sudo",
    ["security", "add-trusted-cert", "-d", "-r", "trustRoot", "-p", "codeSign",
      "-k", "/Library/Keychains/System.keychain", certPath],
    { stdio: "inherit" },
  );
  if (trust.status === 0) return;

  process.stderr.write(
    `\n[identity] The certificate is in your keychain but not yet trusted.\n` +
      `[identity] sudo could not prompt here. Run this line yourself, then re-run this command:\n\n` +
      `  sudo security add-trusted-cert -d -r trustRoot -p codeSign \\\n` +
      `    -k /Library/Keychains/System.keychain ${certPath}\n\n`,
  );
  process.exit(2);
}

const existing = existingCertificatePath();
if (existing) {
  log(`"${LOCAL_SIGNING_IDENTITY}" is already in the keychain but not trusted yet`);
  trustForCodeSigning(existing);
  if (!hasLocalSigningIdentity()) {
    process.stderr.write("[identity] still not valid for code signing — check Keychain Access.\n");
    process.exit(1);
  }
  log(`"${LOCAL_SIGNING_IDENTITY}" is ready.`);
  process.exit(0);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-signing-"));
const keyPath = path.join(workDir, "key.pem");
const certPath = path.join(workDir, "cert.pem");
const p12Path = path.join(workDir, "identity.p12");
// The .p12 is deleted below; the passphrase only guards it in transit to
// `security import`, so it never needs to be remembered or stored.
const p12Password = "devhub";

// `extendedKeyUsage=codeSigning` is what makes the certificate show up under
// `security find-identity -p codesigning`. Without it codesign will not touch
// it, no matter how it is trusted. 10 years so this is genuinely a one-off.
const opensslConfig = path.join(workDir, "openssl.cnf");
fs.writeFileSync(
  opensslConfig,
  [
    "[req]",
    "distinguished_name = dn",
    "x509_extensions = v3",
    "prompt = no",
    "",
    "[dn]",
    `CN = ${LOCAL_SIGNING_IDENTITY}`,
    "",
    "[v3]",
    "basicConstraints = critical,CA:false",
    "keyUsage = critical,digitalSignature",
    "extendedKeyUsage = critical,codeSigning",
    "subjectKeyIdentifier = hash",
    "",
  ].join("\n"),
);

let keptCert = null;
try {
  log("generating a self-signed code-signing certificate…");
  run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath,
    "-days", "3650", "-sha256", "-config", opensslConfig,
  ]);
  // OpenSSL 3 defaults to AES-256-CBC with a SHA-256 MAC, which macOS's
  // SecKeychainItemImport cannot read — it reports the mismatch as
  // "MAC verification failed (wrong password?)", which sends you hunting for a
  // password bug that isn't there. Force the old PBE algorithms Security.framework
  // understands.
  run("openssl", [
    "pkcs12", "-export", "-inkey", keyPath, "-in", certPath,
    "-out", p12Path, "-name", LOCAL_SIGNING_IDENTITY, "-passout", `pass:${p12Password}`,
    "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1",
  ]);

  // `-T /usr/bin/codesign` pre-authorises codesign against the private key so
  // signing does not pop a keychain dialog on every build.
  log(`importing into ${loginKeychain}…`);
  run("security", [
    "import", p12Path, "-k", loginKeychain,
    "-P", p12Password, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security",
  ]);
  // Best-effort: this only saves you an "allow codesign to use this key?"
  // dialog on the first signature, and it needs the keychain password, which
  // we do not have. Failing here must not lose the certificate.
  const partition = spawnSync("security", [
    "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:",
    "-s", "-k", "", loginKeychain,
  ], { stdio: ["ignore", "ignore", "ignore"] });
  if (partition.status !== 0) {
    log("could not pre-authorise codesign — macOS may ask to allow it on the first signature");
  }

  // Keep the certificate: the trust step below may have to be re-run by hand,
  // and it needs a file to point at.
  keptCert = EXPORTED_CERT_PATH;
  fs.copyFileSync(certPath, keptCert);
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

trustForCodeSigning(keptCert);

if (!hasLocalSigningIdentity()) {
  process.stderr.write(
    "[identity] the certificate was created but is not valid for code signing yet.\n" +
      "[identity] Open Keychain Access, find \"" + LOCAL_SIGNING_IDENTITY + "\", and set Trust → Code Signing to Always Trust.\n",
  );
  process.exit(1);
}

log(`"${LOCAL_SIGNING_IDENTITY}" is ready.`);
log("Re-run `npm run desktop:build && npm run desktop:install`, then grant DevHub");
log("Full Disk Access and Local Network once — those grants now survive rebuilds.");
