// Guards dependency installs against the wrong npm major.
//
// CI runs Node 22 (see .nvmrc), which bundles npm 10. npm 11 silently
// regenerates package-lock.json in a shape npm 10 rejects, producing recurring
// "Missing: <pkg> from lock file" failures on CI. This runs in `preinstall`, so
// it only gates `npm install` / `npm ci` (the commands that rewrite the lock) —
// everyday build/test/lint still work on any npm.
//
// Plain ESM with no dependencies: preinstall runs before node_modules exists.

const REQUIRED_MAJOR = 10;

const userAgent = process.env.npm_config_user_agent ?? "";
const match = userAgent.match(/npm\/(\d+)\.\d+\.\d+/);
const major = match ? Number(match[1]) : NaN;

if (major !== REQUIRED_MAJOR) {
  const detected = Number.isNaN(major) ? "unknown" : major;
  process.stderr.write(
    `\n✖ This project pins npm ${REQUIRED_MAJOR} (Node 22 — see .nvmrc), but detected npm ${detected}.\n` +
      `  npm 11 rewrites package-lock.json in a way CI's npm 10 rejects.\n` +
      `  Fix: run \`nvm use\` (or install Node 22), then re-run your npm command.\n\n`,
  );
  process.exit(1);
}
