/**
 * The Linux (systemd --user) counterpart of the macOS launch agent.
 *
 * Rendering lives here, apart from the installer, so it can be tested without
 * touching systemd: a mis-quoted path in a unit file fails at boot, on someone
 * else's machine, with a message about "bad unit file setting".
 */

/** Name of the user unit the installer registers. */
export const PASEO_SYSTEMD_UNIT = "devhub-paseo.service";

/**
 * Quote one value for a systemd unit file.
 *
 * Inside double quotes systemd still expands `%` specifiers and `$` variables,
 * so those are doubled; backslash and quote are escaped. A home directory with
 * a space or a `%` in it is ordinary, not exotic.
 */
export function systemdQuote(value) {
  return `"${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", "$$$$")}"`;
}

/**
 * A path used as a whole setting value (`WorkingDirectory=`, `append:`).
 *
 * These are taken literally, so quotes are NOT stripped — a quoted
 * `WorkingDirectory="/x"` is rejected as "not absolute". Spaces are fine
 * unquoted; only `%` needs doubling, because specifiers expand here too.
 */
export function systemdPath(value) {
  return String(value).replaceAll("%", "%%");
}

/**
 * PATH for the daemon, and so for the terminals and agents it starts.
 *
 * The user's own entries keep their order and priority. DevHub's tools/bin and
 * the daemon's node follow as fallbacks: they must not shadow the user's nvm
 * node or CLIs. Entries inside a versioned app payload (`<devhub>/runtime/<id>`)
 * are dropped because an app update deletes them. No npm prefix is exported here
 * at all: a terminal that inherits one cannot load nvm.
 */
export function buildDaemonPath({ current, delimiter = ":", toolsBin, nodeDir, payloadRoot, exists = () => true }) {
  const inPayload = (dir) => dir === payloadRoot || dir.startsWith(`${payloadRoot}/`);
  const userEntries = String(current || "/usr/bin:/bin").split(delimiter)
    .filter((dir) => dir && dir !== toolsBin && dir !== nodeDir && !dir.includes("node_modules") && !inPayload(dir));
  return [...new Set([...userEntries, toolsBin, nodeDir].filter((dir) => dir && !inPayload(dir) && exists(dir)))].join(delimiter);
}

/**
 * A user unit that runs the daemon in the foreground, like the launchd job.
 *
 * `Restart=on-failure` is launchd's `KeepAlive: SuccessfulExit=false`: restart
 * after a crash, stay down after a clean stop. `UMask=0077` mirrors the
 * plist's Umask 63, since the daemon holds a password hash and session data.
 */
export function renderSystemdUnit({ root, home, args, path, log }) {
  if (!Array.isArray(args) || args.length === 0) throw new Error("renderSystemdUnit needs the daemon command line.");
  return [
    "[Unit]",
    "Description=DevHub-managed Paseo daemon",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdPath(root)}`,
    // The daemon finds claude, cursor-agent, opencode and codex on PATH.
    `Environment=${systemdQuote(`PATH=${path}`)}`,
    `Environment=${systemdQuote(`PASEO_HOME=${home}`)}`,
    `ExecStart=${args.map(systemdQuote).join(" ")}`,
    "Restart=on-failure",
    "RestartSec=10",
    "UMask=0077",
    `StandardOutput=append:${systemdPath(log)}`,
    `StandardError=append:${systemdPath(log)}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
