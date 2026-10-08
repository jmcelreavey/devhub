//! The WSL2 backend for the Windows build.
//!
//! On Windows the Tauri app is only a window. The dashboard, the PTY server and
//! every agent CLI run inside a WSL2 distro, exactly as they do on Linux, and
//! the WebView2 window talks to them over `localhost` (WSL forwards loopback
//! ports to Windows, in both NAT and mirrored networking).
//!
//! What this module owns:
//!
//! - choosing a distro, and booting it if it is stopped
//! - installing the Linux payload (Node, the Next standalone server, services)
//!   into the distro, once per payload version
//! - building the `wsl.exe` command that starts the supervisor
//! - translating paths across the boundary
//!
//! Everything here compiles and unit-tests on every platform. Only the
//! `wsl.exe` invocations themselves are Windows-specific, and they fail with an
//! ordinary "could not run wsl.exe" error elsewhere.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::paths::APP_DATA_SUBDIRS;

/// A cold WSL VM boot is 5–20s; a machine that just woke from sleep can take
/// far longer. Generous, because the failure mode of giving up early is telling
/// the user their working setup is broken.
const BOOT_TIMEOUT: Duration = Duration::from_secs(120);
const QUICK_TIMEOUT: Duration = Duration::from_secs(20);
/// Unpacking a Node runtime plus a traced `node_modules` is thousands of files.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(300);

/// `CREATE_NO_WINDOW`. Without it every `wsl.exe` call flashes a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Distro {
    pub name: String,
    pub running: bool,
    pub version: u8,
    pub is_default: bool,
}

/// A WSL distro we can run the sidecar in.
#[derive(Debug, Clone)]
pub struct WslBackend {
    pub distro: String,
    /// The user's `$HOME` inside the distro.
    pub home: String,
    /// Writable DevHub data, inside the distro's own filesystem.
    ///
    /// On ext4, not under `/mnt/c`: 9P-backed paths are an order of magnitude
    /// slower for the small-file churn of `git` and `node_modules`, and lose
    /// Unix permissions.
    pub app_data: String,
}

impl WslBackend {
    pub fn new(distro: String, home: String) -> Self {
        let app_data = format!("{}/.local/share/devhub", home.trim_end_matches('/'));
        Self {
            distro,
            home,
            app_data,
        }
    }

    /// Where a given payload build is unpacked.
    pub fn payload_dir(&self, payload_id: &str) -> String {
        format!("{}/runtime/{payload_id}", self.app_data)
    }

    /// `wsl.exe -d <distro> …`, hidden, with stdio unset.
    pub fn command(&self) -> Command {
        let mut command = wsl_command();
        command.arg("-d").arg(&self.distro);
        command
    }

    /// Run a program in the distro (no shell, no PATH search beyond `--exec`'s)
    /// and capture stdout. Fails on a non-zero exit or on timeout.
    pub fn exec(&self, argv: &[&str], timeout: Duration) -> Result<String, String> {
        let mut command = self.command();
        command.arg("--exec").args(argv);
        run_captured(command, timeout)
    }

    /// Make sure the distro's VM is up.
    ///
    /// Any `--exec` call starts a stopped distro, so running `true` is both the
    /// probe and the boot. Returns once the distro answers.
    pub fn ensure_running(&self) -> Result<(), String> {
        self.exec(&["/bin/true"], BOOT_TIMEOUT)
            .map(|_| ())
            .map_err(|err| format!("Could not start the WSL distro \"{}\": {err}", self.distro))
    }

    /// Create the writable data tree, `0700`, inside the distro.
    pub fn ensure_app_data(&self) -> Result<(), String> {
        let mut argv: Vec<String> = vec!["mkdir".into(), "-p".into(), "-m".into(), "700".into()];
        argv.push(self.app_data.clone());
        for sub in APP_DATA_SUBDIRS {
            argv.push(format!("{}/{sub}", self.app_data));
        }
        let refs: Vec<&str> = argv.iter().map(String::as_str).collect();
        self.exec(&refs, QUICK_TIMEOUT).map(|_| ())
    }

    /// Read both IPv4 and IPv6 listeners in one call, without requiring lsof.
    pub fn listening_ports(&self) -> Result<Vec<u16>, String> {
        self.exec(
            &[
                "/bin/sh",
                "-c",
                "set -e; cat /proc/net/tcp; if [ -f /proc/net/tcp6 ]; then cat /proc/net/tcp6; fi",
            ],
            QUICK_TIMEOUT,
        )
        .map(|table| parse_listening_ports(&table))
    }

    /// The content repo linked through the setup wizard, if any.
    ///
    /// Content-only Git linking keeps configuration in app data. Auto-detecting
    /// that clone as a legacy checkout would switch to an absent .env.local.
    pub fn content_repo_link(&self) -> Option<String> {
        self.exec(
            &[
                "/bin/cat",
                &format!("{}/content-repo-path.txt", self.app_data),
            ],
            QUICK_TIMEOUT,
        )
        .ok()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    }

    /// The checkout the user's own `devhub.service` runs against, when that
    /// service exists. Its working directory is either `<repo>/dashboard`
    /// (`next start` there) or `<repo>` (`npm start` at the root); a directory
    /// that is not a DevHub checkout is no answer.
    pub fn running_service_repo(&self) -> Option<String> {
        let dir = self
            .exec(
                &[
                    "/bin/systemctl",
                    "--user",
                    "show",
                    "devhub.service",
                    "-p",
                    "WorkingDirectory",
                    "--value",
                ],
                QUICK_TIMEOUT,
            )
            .ok()?;
        let repo = service_repo_root(&dir)?;
        self.exec(
            &[
                "/bin/sh",
                "-c",
                r#"[ -f "$1/package.json" ] && [ -d "$1/dashboard" ]"#,
                "devhub-checkout",
                &repo,
            ],
            QUICK_TIMEOUT,
        )
        .ok()
        .map(|_| repo)
    }

    /// The DevHub git checkout to run against, if there is one.
    ///
    /// `preferred` is an explicit path (`DEVHUB_WSL_REPO` / `wsl-repo.txt`);
    /// `none` opts out and gives a fresh, self-contained install. Otherwise the
    /// usual places are probed. A candidate must look like a DevHub checkout
    /// (`package.json`, `dashboard/`, and a `.git`), so an unrelated `~/devhub`
    /// is never adopted.
    pub fn find_checkout(&self, preferred: Option<&str>) -> Option<String> {
        let preferred = preferred.map(str::trim).filter(|p| !p.is_empty());
        if preferred.is_some_and(|p| p.eq_ignore_ascii_case("none")) {
            return None;
        }
        let home = self.home.trim_end_matches('/');
        let mut candidates: Vec<String> = preferred.map(str::to_string).into_iter().collect();
        for tail in [
            "dev/devhub-private",
            "dev/devhub",
            "devhub-private",
            "devhub",
            "Developer/devhub-private",
            "Developer/devhub",
        ] {
            candidates.push(format!("{home}/{tail}"));
        }
        let script = r#"for d in "$@"; do
  if [ -f "$d/package.json" ] && [ -d "$d/dashboard" ] && [ -e "$d/.git" ]; then
    printf %s "$d"; exit 0
  fi
done
exit 1"#;
        let mut argv: Vec<&str> = vec!["/bin/sh", "-c", script, "devhub-find"];
        argv.extend(candidates.iter().map(String::as_str));
        self.exec(&argv, QUICK_TIMEOUT)
            .ok()
            .map(|found| found.trim().to_string())
            .filter(|found| found.starts_with('/'))
    }

    /// Is this payload build already unpacked and complete?
    pub fn payload_installed(&self, payload_id: &str) -> bool {
        let marker = format!("{}/.complete", self.payload_dir(payload_id));
        self.exec(&["/usr/bin/test", "-f", &marker], QUICK_TIMEOUT)
            .is_ok()
    }

    /// Unpack the bundled payload into the distro. Older builds are removed
    /// separately by `prune_old_payloads`, after `repair_paseo_unit` has made
    /// sure no service still runs a binary from one of them.
    ///
    /// Extracts to `<id>.partial` and renames, so a crash mid-extract leaves a
    /// directory the next launch ignores rather than a half-installed runtime
    /// that looks complete. `.complete` is written last for the same reason.
    pub fn install_payload(
        &self,
        tarball_windows_path: &Path,
        payload_id: &str,
    ) -> Result<(), String> {
        let tarball = to_wsl_path(&tarball_windows_path.to_string_lossy())
            .ok_or_else(|| format!("Cannot map {} into WSL", tarball_windows_path.display()))?;
        let root = format!("{}/runtime", self.app_data);
        let script = r#"
set -e
root="$1"; id="$2"; tarball="$3"
mkdir -p "$root"
rm -rf "$root/$id.partial"
mkdir -p "$root/$id.partial"
tar -xzf "$tarball" -C "$root/$id.partial"
rm -rf "$root/$id"
mv "$root/$id.partial" "$root/$id"
touch "$root/$id/.complete"
"#;
        let mut command = self.command();
        command.arg("--exec").args([
            "/bin/sh",
            "-c",
            script,
            "devhub-install",
            &root,
            payload_id,
            &tarball,
        ]);
        run_captured(command, INSTALL_TIMEOUT)
            .map(|_| ())
            .map_err(|err| format!("Could not install DevHub into WSL: {err}"))
    }

    /// Make the managed Paseo unit independent of any versioned payload.
    ///
    /// Older builds registered `devhub-paseo.service` with a node binary inside
    /// `runtime/<payload-id>/`. Removing that payload on update left the running
    /// daemon on a deleted executable, and the next restart failed with 203/EXEC.
    /// This copies that node to `paseo/runtime/node`, rewrites the unit to use it
    /// and drops the npm prefix and payload/bundled-node PATH entries earlier
    /// units carried. It never restarts the daemon.
    pub fn repair_paseo_unit(&self, payload_id: &str) -> Result<PaseoUnitRepair, String> {
        let unit_path = paseo_unit_path(&self.home);
        let Ok(unit) = self.exec(&["/bin/cat", &unit_path], QUICK_TIMEOUT) else {
            return Ok(PaseoUnitRepair::NoUnit);
        };
        let durable_node = paseo_durable_node(&self.app_data);
        let Some(rewritten) = rewrite_paseo_unit(&unit, &self.app_data, &durable_node) else {
            return Ok(PaseoUnitRepair::Unchanged);
        };
        let old_binary = paseo_exec_binary(&unit).unwrap_or_default();
        // The unit's own node when it still exists; otherwise this payload's.
        // A same-major node beats a unit that cannot start.
        let fallback = format!("{}/runtime/node", self.payload_dir(payload_id));
        let copy = r#"
set -e
dest="$1"; preferred="$2"; fallback="$3"
if [ ! -x "$dest" ]; then
  src="$preferred"; [ -x "$src" ] || src="$fallback"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest.next"
  chmod 755 "$dest.next"
  mv "$dest.next" "$dest"
fi
"#;
        self.exec(
            &[
                "/bin/sh",
                "-c",
                copy,
                "devhub-paseo-node",
                &durable_node,
                &old_binary,
                &fallback,
            ],
            INSTALL_TIMEOUT,
        )
        .map_err(|err| format!("Could not keep Paseo's Node runtime: {err}"))?;
        // The running daemon still has the old unit's environment. The marker
        // tells the dashboard to apply it once Paseo is idle.
        let write = r#"
set -e
printf '%s\n' "$2" > "$1.next"
mv "$1.next" "$1"
mkdir -p "$(dirname "$3")"
: > "$3"
systemctl --user daemon-reload || true
"#;
        self.exec(
            &[
                "/bin/sh",
                "-c",
                write,
                "devhub-paseo-unit",
                &unit_path,
                rewritten.trim_end(),
                &paseo_restart_marker(&self.app_data),
            ],
            QUICK_TIMEOUT,
        )
        .map_err(|err| format!("Could not update the Paseo service: {err}"))?;
        Ok(PaseoUnitRepair::Repaired { old_binary })
    }

    /// Does the managed Paseo unit point at an executable that is missing?
    /// Reported in the shell log; Agents → Connection shows the same warning.
    pub fn paseo_unit_binary_missing(&self) -> Option<String> {
        let unit = self
            .exec(&["/bin/cat", &paseo_unit_path(&self.home)], QUICK_TIMEOUT)
            .ok()?;
        let binary = paseo_exec_binary(&unit)?;
        self.exec(&["/usr/bin/test", "-x", &binary], QUICK_TIMEOUT)
            .is_err()
            .then_some(binary)
    }

    /// Remove every unpacked payload except the current one.
    pub fn prune_old_payloads(&self, payload_id: &str) -> Result<(), String> {
        let script = r#"
root="$1"; id="$2"
for old in "$root"/*; do
  [ -e "$old" ] || continue
  [ "$old" = "$root/$id" ] || rm -rf "$old"
done
"#;
        let root = format!("{}/runtime", self.app_data);
        self.exec(
            &["/bin/sh", "-c", script, "devhub-prune", &root, payload_id],
            INSTALL_TIMEOUT,
        )
        .map(|_| ())
    }

    /// The command that runs the supervisor, stdin piped.
    ///
    /// The launcher script (shipped in the payload) starts the supervisor under
    /// the user's *login, interactive* shell so agent CLIs installed through
    /// nvm/volta/asdf resolve exactly as they do in the user's own terminal.
    /// `--exec` alone would give the supervisor WSL's bare default PATH.
    ///
    /// Configuration crosses over in the environment, named in `WSLENV`, rather
    /// than on the command line: the bootstrap token must not show up in a
    /// process listing on either side.
    pub fn sidecar_command(
        &self,
        payload: &str,
        env: &std::collections::BTreeMap<String, String>,
    ) -> Command {
        let mut command = self.command();
        command
            .arg("--cd")
            .arg(format!("{payload}/server"))
            .arg("--exec")
            .arg(format!("{payload}/bin/devhub-wsl-launch"))
            .arg(payload)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (key, value) in env {
            command.env(key, value);
        }
        command.env("WSLENV", wslenv(env.keys().map(String::as_str)));
        command
    }

    /// Last resort after a graceful stop timed out: kill our supervisor by its
    /// exact path. Scoped to this payload build, so it cannot touch a checkout
    /// dev server or another user's DevHub.
    pub fn kill_supervisor(&self, payload: &str) {
        let pattern = format!("{payload}/services/supervisor.mjs");
        let _ = self.exec(&["/usr/bin/pkill", "-f", &pattern], QUICK_TIMEOUT);
    }
}

pub fn parse_listening_ports(table: &str) -> Vec<u16> {
    table
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.get(3) != Some(&"0A") {
                return None;
            }
            let (_, port) = fields.get(1)?.rsplit_once(':')?;
            u16::from_str_radix(port, 16).ok()
        })
        .collect()
}

/// The checkout a service's working directory points at: `<repo>/dashboard`
/// and `<repo>` both name `<repo>`. This is only the path; the caller checks it
/// really is a DevHub checkout.
pub fn service_repo_root(working_directory: &str) -> Option<String> {
    let dir = working_directory.trim().trim_end_matches('/');
    let repo = dir.strip_suffix("/dashboard").unwrap_or(dir);
    (repo.starts_with('/') && repo.len() > 1).then(|| repo.to_string())
}

/// Should this app defer scheduled jobs to a service already holding the
/// default ports? Only when both work on the same content: a fresh app-data
/// profile, or one linked to a different repo, has jobs of its own that nothing
/// else will run. With no way to tell what the running service uses, assume it
/// shares our content (the safe side: no duplicate jobs).
/// Returns the decision with its reason, for the shell log.
pub fn content_sharing(
    own_content_root: Option<&str>,
    service_repo: Option<&str>,
) -> (bool, &'static str) {
    let normalise = |path: &str| path.trim_end_matches('/').to_string();
    match (own_content_root, service_repo) {
        (None, _) => (false, "this profile uses its own app data"),
        (Some(_), None) => (
            true,
            "could not tell which checkout the running service uses",
        ),
        (Some(own), Some(service)) if normalise(own) == normalise(service) => {
            (true, "the running service uses the same checkout")
        }
        (Some(_), Some(_)) => (false, "the running service uses a different checkout"),
    }
}

/// What `repair_paseo_unit` found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaseoUnitRepair {
    /// No managed Paseo service is registered in this distro.
    NoUnit,
    /// The service already runs a durable node with a clean environment.
    Unchanged,
    /// The service was moved off a versioned payload (or cleaned up).
    Repaired { old_binary: String },
}

const PASEO_UNIT: &str = "devhub-paseo.service";

pub fn paseo_unit_path(home: &str) -> String {
    format!(
        "{}/.config/systemd/user/{PASEO_UNIT}",
        home.trim_end_matches('/')
    )
}

/// Left after a unit rewrite; the dashboard restarts Paseo (when idle) and clears it.
/// Keep in step with `pendingRestartMarker` in `dashboard/lib/paseo/pending-restart.ts`.
pub fn paseo_restart_marker(app_data: &str) -> String {
    format!("{app_data}/paseo/restart-pending")
}

/// The shell-log line for a rewritten unit. A unit that already ran the durable
/// node was only cleaned up; saying it was "moved" would send a reader looking
/// for a node binary that never changed.
pub fn describe_paseo_repair(old_binary: &str, durable_node: &str) -> String {
    if old_binary == durable_node {
        "[paseo] cleaned the Paseo service environment (npm prefix, payload PATH)".to_string()
    } else {
        format!("[paseo] moved the Paseo service off {old_binary} to its own node runtime")
    }
}

/// The copy of node the Paseo daemon owns, outside every versioned payload.
pub fn paseo_durable_node(app_data: &str) -> String {
    format!("{app_data}/paseo/runtime/node")
}

/// systemd double-quote escaping, matching `systemdQuote` in `paseo-service.mjs`.
fn systemd_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('%', "%%")
            .replace('$', "$$")
    )
}

fn systemd_unquote(value: &str) -> String {
    value
        .replace("%%", "%")
        .replace("$$", "$")
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
}

/// The first token of `ExecStart=` (the daemon's executable), unquoted, and the
/// rest of the line after it.
fn split_exec_start(line: &str) -> Option<(String, &str)> {
    let value = line.strip_prefix("ExecStart=")?;
    if let Some(quoted) = value.strip_prefix('"') {
        let mut escaped = false;
        for (index, ch) in quoted.char_indices() {
            match ch {
                '\\' if !escaped => escaped = true,
                '"' if !escaped => {
                    return Some((systemd_unquote(&quoted[..index]), &quoted[index + 1..]));
                }
                _ => escaped = false,
            }
        }
        None
    } else {
        let end = value.find(char::is_whitespace).unwrap_or(value.len());
        Some((value[..end].to_string(), &value[end..]))
    }
}

pub fn paseo_exec_binary(unit: &str) -> Option<String> {
    unit.lines()
        .find_map(|line| split_exec_start(line).map(|(binary, _)| binary))
}

/// Rewrite an older managed Paseo unit, or `None` when it needs no change.
///
/// - `ExecStart` under `<app-data>/runtime/` moves to `durable_node`;
/// - `NPM_CONFIG_PREFIX` / `npm_config_prefix` pointing at DevHub's tools
///   directory are dropped, so terminals started by Paseo do not inherit them
///   (nvm refuses to load while they are set);
/// - `PATH` loses payload and bundled-node entries, and `tools/bin` moves last
///   so it cannot shadow the user's own tools.
pub fn rewrite_paseo_unit(unit: &str, app_data: &str, durable_node: &str) -> Option<String> {
    let payloads = format!("{app_data}/runtime/");
    let tools = format!("{app_data}/tools");
    let tools_bin = format!("{tools}/bin");
    let bundled_node_dir = durable_node
        .rsplit_once('/')
        .map(|(dir, _)| dir.to_string());
    let mut changed = false;
    let mut out: Vec<String> = Vec::new();
    for line in unit.lines() {
        if let Some((binary, rest)) = split_exec_start(line) {
            if binary.starts_with(&payloads) {
                changed = true;
                out.push(format!("ExecStart={}{rest}", systemd_quote(durable_node)));
                continue;
            }
        } else if let Some(value) = line
            .strip_prefix("Environment=\"NPM_CONFIG_PREFIX=")
            .or_else(|| line.strip_prefix("Environment=\"npm_config_prefix="))
        {
            if systemd_unquote(value.trim_end_matches('"')) == tools {
                changed = true;
                continue;
            }
        } else if let Some(value) = line.strip_prefix("Environment=\"PATH=") {
            let entries: Vec<String> = systemd_unquote(value.trim_end_matches('"'))
                .split(':')
                .filter(|entry| !entry.is_empty())
                .map(str::to_string)
                .collect();
            let mut kept: Vec<String> = entries
                .iter()
                .filter(|entry| {
                    !entry.starts_with(&payloads)
                        && **entry != tools_bin
                        && Some(entry.as_str()) != bundled_node_dir.as_deref()
                })
                .cloned()
                .collect();
            if entries.contains(&tools_bin) {
                kept.push(tools_bin.clone());
            }
            if kept != entries {
                changed = true;
                out.push(format!(
                    "Environment={}",
                    systemd_quote(&format!("PATH={}", kept.join(":")))
                ));
                continue;
            }
        }
        out.push(line.to_string());
    }
    changed.then(|| format!("{}\n", out.join("\n")))
}

/// Probe both requested ports before choosing alternatives, so a pinned-port
/// failure reports every conflict in one pass.
pub fn select_ports(
    preferred: [u16; 2],
    automatic: [bool; 2],
    mut available: impl FnMut(u16) -> bool,
) -> Result<[u16; 2], String> {
    if preferred.contains(&0) || preferred[0] == preferred[1] {
        return Err("Dashboard and terminal ports must be different, between 1 and 65535.".into());
    }
    let occupied = preferred.map(|port| !available(port));
    let conflicts = preferred
        .iter()
        .enumerate()
        .filter(|(index, _)| occupied[*index])
        .map(|(index, port)| {
            format!(
                "{} {port}",
                if index == 0 { "dashboard" } else { "terminal" }
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    if occupied
        .iter()
        .enumerate()
        .any(|(index, busy)| *busy && !automatic[index])
    {
        return Err(format!("Requested ports are in use: {conflicts}. Change DEVHUB_PORT / DEVHUB_TERMINAL_PORT, or stop the service using those ports, then Retry."));
    }
    let mut selected = preferred;
    for index in 0..2 {
        if !occupied[index] && (index == 0 || selected[0] != selected[1]) {
            continue;
        }
        selected[index] = (1..=128).filter_map(|offset| preferred[index].checked_add(offset))
            .find(|port| *port != selected[1 - index] && available(*port))
            .ok_or_else(|| format!("Could not find free dashboard and terminal ports. Occupied: {conflicts}. Close an unused service and Retry."))?;
    }
    Ok(selected)
}

/// Like `select_ports`, but when the defaults are taken and the ports this
/// profile used last time are free, reuse them. WebView storage (view
/// preferences, terminal history) is keyed by origin, so a profile that lands
/// on a different fallback port each launch keeps losing its settings.
pub fn select_ports_preferring(
    preferred: [u16; 2],
    previous: Option<[u16; 2]>,
    automatic: [bool; 2],
    mut available: impl FnMut(u16) -> bool,
) -> Result<[u16; 2], String> {
    if let Some(previous) = previous {
        let defaults_taken = preferred.iter().any(|port| !available(*port));
        if defaults_taken
            && automatic == [true, true]
            && previous[0] != previous[1]
            && !previous.contains(&0)
            && previous.iter().all(|port| available(*port))
        {
            return Ok(previous);
        }
    }
    select_ports(preferred, automatic, available)
}

/// `"1338 1341"` as written by the shell, or `None` for anything else.
pub fn parse_saved_ports(text: &str) -> Option<[u16; 2]> {
    let mut parts = text.split_whitespace().map(str::parse::<u16>);
    let ports = [parts.next()?.ok()?, parts.next()?.ok()?];
    (parts.next().is_none() && ports[0] != ports[1] && !ports.contains(&0)).then_some(ports)
}

fn wsl_command() -> Command {
    #[allow(unused_mut)] // only mutated on Windows, for CREATE_NO_WINDOW
    let mut command = Command::new("wsl.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Merge `names` into any `WSLENV` the user already has, so their own
/// forwarded variables keep working.
fn wslenv<'a>(names: impl Iterator<Item = &'a str>) -> String {
    let mut parts: Vec<String> = std::env::var("WSLENV")
        .ok()
        .map(|existing| {
            existing
                .split(':')
                .filter(|p| !p.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    for name in names {
        if !parts.iter().any(|p| p.split('/').next() == Some(name)) {
            parts.push(name.to_string());
        }
    }
    parts.join(":")
}

/// Leave provisioning visible: Windows may ask for a restart and Ubuntu for a
/// username. Those prompts cannot be completed by a hidden background process.
#[cfg(target_os = "windows")]
pub fn launch_installer() -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let system_root =
        std::env::var_os("SystemRoot").ok_or("Windows system directory is unavailable.")?;
    let powershell = std::path::PathBuf::from(system_root)
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = Command::new(powershell);
    command.creation_flags(CREATE_NO_WINDOW);
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/wsl.exe') -ArgumentList '--install','-d','Ubuntu' -Verb RunAs",
    ]);
    run_captured(command, Duration::from_secs(90))
        .map(|_| ())
        .map_err(|err| format!("Could not open Windows setup: {err}"))
}

/// Run to completion with a deadline. `wsl.exe` can hang on a wedged VM, and a
/// launcher that hangs silently is indistinguishable from a crash.
fn run_captured(mut command: Command, timeout: Duration) -> Result<String, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|err| format!("could not run wsl.exe: {err}"))?;

    // Drain both pipes on threads: a child that fills a pipe buffer while we
    // poll `try_wait` would otherwise deadlock until the timeout.
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out_thread = std::thread::spawn(move || read_all(stdout.as_mut()));
    let err_thread = std::thread::spawn(move || read_all(stderr.as_mut()));

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("timed out after {}s", timeout.as_secs()));
            }
            Err(err) => return Err(err.to_string()),
        }
    };

    let stdout = decode_wsl_output(&out_thread.join().unwrap_or_default());
    let stderr = decode_wsl_output(&err_thread.join().unwrap_or_default());
    if status.success() {
        Ok(stdout)
    } else {
        let detail = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        Err(format!("exit {status}: {}", detail.trim()))
    }
}

fn read_all<R: Read>(reader: Option<&mut R>) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Some(reader) = reader {
        let _ = reader.read_to_end(&mut buf);
    }
    buf
}

/// `wsl.exe`'s own messages (`-l`, `--status`, errors) are UTF-16LE. Output
/// relayed from Linux programs is UTF-8. Telling them apart by NUL bytes is
/// what every WSL wrapper ends up doing.
pub fn decode_wsl_output(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes.iter().skip(1).step_by(2).any(|b| *b == 0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
            .trim_start_matches('\u{feff}')
            .to_string()
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

/// Parse `wsl.exe -l -v`.
///
/// ```text
///   NAME              STATE           VERSION
/// * Ubuntu            Running         2
///   docker-desktop    Stopped         2
/// ```
///
/// Column headers are localised on non-English Windows, so the header row is
/// skipped by position rather than matched by text.
pub fn parse_distro_list(text: &str) -> Vec<Distro> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let is_default = line.trim_start().starts_with('*');
            let cleaned = line.trim().trim_start_matches('*').trim();
            let mut fields = cleaned.split_whitespace();
            let name = fields.next()?.to_string();
            let state = fields.next()?;
            let version = fields.next()?.parse::<u8>().ok()?;
            Some(Distro {
                name,
                // "Running" is the only state string that is not localised
                // consistently, so treat everything else as stopped: booting a
                // running distro is a no-op and the reverse is not.
                running: state.eq_ignore_ascii_case("running"),
                version,
                is_default,
            })
        })
        .collect()
}

/// Distros that exist for Docker/Rancher's own use and cannot run DevHub.
fn is_internal_distro(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("docker-desktop") || lower.starts_with("rancher-desktop")
}

/// Pick the distro to run in: an explicit choice, else the default, else the
/// first usable WSL2 distro.
pub fn choose_distro(distros: &[Distro], preferred: Option<&str>) -> Result<String, String> {
    if let Some(wanted) = preferred.map(str::trim).filter(|w| !w.is_empty()) {
        let distro = distros.iter().find(|d| d.name.eq_ignore_ascii_case(wanted))
            .ok_or_else(|| {
                format!("The WSL distro \"{wanted}\" (DEVHUB_WSL_DISTRO or wsl-distro.txt) is not installed.")
            })?;
        if distro.version != 2 || is_internal_distro(&distro.name) {
            return Err(format!(
                "DevHub needs a user WSL 2 distro; \"{}\" cannot be used.",
                distro.name
            ));
        }
        return Ok(distro.name.clone());
    }
    let usable = |d: &&Distro| d.version == 2 && !is_internal_distro(&d.name);
    distros
        .iter()
        .filter(usable)
        .find(|d| d.is_default)
        .or_else(|| distros.iter().find(usable))
        .map(|d| d.name.clone())
        .ok_or_else(|| {
            if distros.iter().any(|d| !is_internal_distro(&d.name)) {
                "Your WSL distros are WSL 1. DevHub needs WSL 2: run `wsl --set-version <distro> 2`, then Retry."
                    .to_string()
            } else {
                "No WSL distro is installed. Open PowerShell as administrator, run `wsl --install`, restart, then Retry."
                    .to_string()
            }
        })
}

/// List installed distros. An error here almost always means WSL itself is not
/// installed, which gets its own message.
pub fn list_distros() -> Result<Vec<Distro>, String> {
    let mut command = wsl_command();
    command.args(["-l", "-v"]);
    match run_captured(command, QUICK_TIMEOUT) {
        Ok(text) => Ok(parse_distro_list(&text)),
        Err(err) if err.contains("could not run wsl.exe") => Err(
            "WSL is not installed. Open PowerShell as administrator, run `wsl --install`, restart, then Retry."
                .to_string(),
        ),
        // An unsuccessful query may also mean a broken WSL installation.
        // Preserve its diagnostic rather than treating every failure as empty.
        Err(err) => Err(err),
    }
}

/// Resolve the distro and its `$HOME`. Boots the distro as a side effect of
/// asking it for the home directory.
#[derive(Debug)]
pub struct ResolveError {
    pub message: String,
    pub install_available: bool,
}

impl From<String> for ResolveError {
    fn from(message: String) -> Self {
        Self {
            message,
            install_available: false,
        }
    }
}

pub fn resolve_backend(preferred: Option<&str>) -> Result<WslBackend, ResolveError> {
    let distros = list_distros().map_err(|message| ResolveError {
        message,
        install_available: preferred.is_none(),
    })?;
    let name = choose_distro(&distros, preferred).map_err(|message| ResolveError {
        message,
        // Offer a new Ubuntu install only when there is no user distro to
        // convert or explicit choice to repair. Never alter an existing distro.
        install_available: preferred.is_none()
            && !distros.iter().any(|d| !is_internal_distro(&d.name)),
    })?;
    let probe = WslBackend::new(name.clone(), String::new());
    probe.ensure_running()?;
    let home = probe
        .exec(&["/bin/sh", "-c", "printf %s \"$HOME\""], QUICK_TIMEOUT)
        .map_err(|err| format!("Could not read $HOME in \"{name}\": {err}"))?;
    let home = home.trim().to_string();
    if !home.starts_with('/') {
        return Err(format!("\"{name}\" reported an unusable home directory: {home:?}").into());
    }
    Ok(WslBackend::new(name, home))
}

/// Windows path → the path WSL sees.
///
/// `C:\Users\me\code` → `/mnt/c/Users/me/code`;
/// `\\wsl.localhost\Ubuntu\home\me` → `/home/me` (a path that already lives in
/// the distro, such as one picked through the `\\wsl.localhost` share).
/// Returns `None` for shapes with no Linux equivalent.
pub fn to_wsl_path(windows_path: &str) -> Option<String> {
    // Tauri hands out verbatim paths (`\\?\C:\…`) for resources.
    let path = windows_path.strip_prefix(r"\\?\").unwrap_or(windows_path);

    for prefix in [r"\\wsl.localhost\", r"\\wsl$\"] {
        if let Some(rest) = strip_prefix_ignore_case(path, prefix) {
            let (_distro, inner) = rest.split_once('\\').unwrap_or((rest, ""));
            let unix = inner.replace('\\', "/");
            return Some(format!("/{}", unix.trim_start_matches('/')));
        }
    }

    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        let rest = path[2..].replace('\\', "/");
        let rest = rest.trim_start_matches('/');
        return Some(if rest.is_empty() {
            format!("/mnt/{drive}")
        } else {
            format!("/mnt/{drive}/{}", rest.trim_end_matches('/'))
        });
    }
    None
}

/// A path in the distro → the UNC path Windows can open, for the file dialog's
/// starting folder.
pub fn to_windows_path(distro: &str, unix_path: &str) -> String {
    format!(r"\\wsl.localhost\{distro}{}", unix_path.replace('/', "\\"))
}

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
    }

    #[test]
    fn decodes_utf16_output_from_wsl_itself() {
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend(utf16le(
            "  NAME  STATE  VERSION\r\n* Ubuntu  Running  2\r\n",
        ));
        let text = decode_wsl_output(&bytes);
        assert!(text.starts_with("  NAME"), "BOM must be stripped: {text:?}");
        assert!(text.contains("Ubuntu"));
    }

    #[test]
    fn leaves_utf8_output_from_linux_programs_alone() {
        assert_eq!(decode_wsl_output(b"/home/me"), "/home/me");
        assert_eq!(decode_wsl_output(b""), "");
        assert_eq!(decode_wsl_output(b"a"), "a");
    }

    #[test]
    fn reads_only_listening_ports_from_both_tcp_tables() {
        let table = "sl local_address rem_address st\n0: 0100007F:0539 00000000:0000 0A\n1: 0100007F:053B 0100007F:9999 01\n2: 00000000000000000000000000000000:053B 00000000:0000 0A\n";
        assert_eq!(parse_listening_ports(table), vec![1337, 1339]);
    }

    #[test]
    fn chooses_distinct_free_ports_without_stopping_existing_services() {
        assert_eq!(
            select_ports([1337, 1339], [true, true], |p| ![1337, 1339].contains(&p)).unwrap(),
            [1338, 1340]
        );
        assert_eq!(
            select_ports([1337, 1338], [true, true], |p| p != 1337).unwrap(),
            [1339, 1338]
        );
        assert_eq!(
            select_ports([1337, 1339], [true, true], |_| true).unwrap(),
            [1337, 1339]
        );
    }

    #[test]
    fn reports_all_conflicts_when_a_port_is_pinned() {
        let error = select_ports([1337, 1339], [false, true], |_| false).unwrap_err();
        assert!(error.contains("dashboard 1337"), "{error}");
        assert!(error.contains("terminal 1339"), "{error}");
    }

    #[test]
    fn rejects_invalid_ports_and_bounds_the_search() {
        assert!(select_ports([0, 1339], [true, true], |_| true).is_err());
        assert!(select_ports([1337, 1337], [false, false], |_| true).is_err());
        assert!(select_ports([65535, 1339], [true, true], |_| false).is_err());
    }

    const LIST: &str = "  NAME              STATE           VERSION\r\n\
* Ubuntu-24.04      Stopped         2\r\n\
  docker-desktop    Running         2\r\n\
  Legacy            Stopped         1\r\n";

    #[test]
    fn parses_the_distro_table() {
        let distros = parse_distro_list(LIST);
        assert_eq!(distros.len(), 3);
        assert_eq!(distros[0].name, "Ubuntu-24.04");
        assert!(distros[0].is_default && !distros[0].running);
        assert!(distros[1].running);
        assert_eq!(distros[2].version, 1);
    }

    #[test]
    fn prefers_the_default_wsl2_distro() {
        let distros = parse_distro_list(LIST);
        assert_eq!(choose_distro(&distros, None).unwrap(), "Ubuntu-24.04");
    }

    #[test]
    fn never_picks_docker_desktop_or_wsl1() {
        let distros = parse_distro_list(
            "  NAME STATE VERSION\r\n* docker-desktop Running 2\r\n  Old Stopped 1\r\n",
        );
        let err = choose_distro(&distros, None).unwrap_err();
        assert!(err.contains("WSL 1"), "{err}");

        let none = parse_distro_list("  NAME STATE VERSION\r\n* docker-desktop Running 2\r\n");
        assert!(choose_distro(&none, None)
            .unwrap_err()
            .contains("wsl --install"));
    }

    #[test]
    fn falls_back_to_first_usable_when_default_is_unusable() {
        let distros = parse_distro_list(
            "  NAME STATE VERSION\r\n* docker-desktop Running 2\r\n  Debian Stopped 2\r\n",
        );
        assert_eq!(choose_distro(&distros, None).unwrap(), "Debian");
    }

    #[test]
    fn an_explicit_choice_wins_and_must_exist() {
        let distros = parse_distro_list(LIST);
        assert_eq!(
            choose_distro(&distros, Some("ubuntu-24.04")).unwrap(),
            "Ubuntu-24.04"
        );
        assert!(choose_distro(&distros, Some("legacy")).is_err());
        assert!(choose_distro(&distros, Some("docker-desktop")).is_err());
        assert!(choose_distro(&distros, Some("Nope")).is_err());
    }

    #[test]
    fn maps_drive_paths_into_mnt() {
        assert_eq!(
            to_wsl_path(r"C:\Users\me\code").as_deref(),
            Some("/mnt/c/Users/me/code")
        );
        assert_eq!(to_wsl_path(r"d:\").as_deref(), Some("/mnt/d"));
        assert_eq!(to_wsl_path(r"C:\x\").as_deref(), Some("/mnt/c/x"));
        assert_eq!(
            to_wsl_path(r"\\?\C:\Program Files\DevHub\wsl\p.tar.gz").as_deref(),
            Some("/mnt/c/Program Files/DevHub/wsl/p.tar.gz"),
            "Tauri's verbatim resource paths must map"
        );
    }

    #[test]
    fn maps_wsl_shares_back_to_native_paths() {
        assert_eq!(
            to_wsl_path(r"\\wsl.localhost\Ubuntu\home\me\dev").as_deref(),
            Some("/home/me/dev")
        );
        assert_eq!(
            to_wsl_path(r"\\wsl$\Ubuntu\home\me").as_deref(),
            Some("/home/me")
        );
        assert_eq!(to_wsl_path(r"\\WSL.LOCALHOST\Ubuntu").as_deref(), Some("/"));
    }

    #[test]
    fn rejects_paths_with_no_linux_equivalent() {
        assert_eq!(to_wsl_path(r"\\fileserver\share\x"), None);
        assert_eq!(to_wsl_path("relative\\path"), None);
        assert_eq!(to_wsl_path(""), None);
    }

    #[test]
    fn builds_unc_paths_for_the_file_dialog() {
        assert_eq!(
            to_windows_path("Ubuntu", "/home/me/dev"),
            r"\\wsl.localhost\Ubuntu\home\me\dev"
        );
    }

    #[test]
    fn wslenv_keeps_the_users_own_forwarded_variables() {
        // Serialised through one test: WSLENV is process-global.
        std::env::set_var("WSLENV", "MYVAR/p:OTHER");
        let merged = wslenv(["PORT", "OTHER"].into_iter());
        std::env::remove_var("WSLENV");
        assert_eq!(merged, "MYVAR/p:OTHER:PORT");
    }

    #[test]
    fn app_data_lives_on_the_distro_filesystem() {
        let backend = WslBackend::new("Ubuntu".into(), "/home/me/".into());
        assert_eq!(backend.app_data, "/home/me/.local/share/devhub");
        assert_eq!(
            backend.payload_dir("abc"),
            "/home/me/.local/share/devhub/runtime/abc"
        );
        assert!(!backend.app_data.starts_with("/mnt/"));
    }

    #[test]
    fn sidecar_command_keeps_the_token_off_the_command_line() {
        let backend = WslBackend::new("Ubuntu".into(), "/home/me".into());
        let mut env = std::collections::BTreeMap::new();
        env.insert("DEVHUB_BOOTSTRAP_TOKEN".to_string(), "s3cret".to_string());
        env.insert("PORT".to_string(), "1337".to_string());
        let command = backend.sidecar_command(&backend.payload_dir("abc"), &env);
        let args: Vec<String> = command
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(!args.iter().any(|a| a.contains("s3cret")), "{args:?}");
        assert_eq!(&args[..2], ["-d", "Ubuntu"]);
        assert!(args.contains(&"--exec".to_string()));
        let wslenv_value = command
            .get_envs()
            .find(|(k, _)| *k == "WSLENV")
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().to_string())
            .unwrap();
        assert!(wslenv_value.contains("DEVHUB_BOOTSTRAP_TOKEN"));
        assert!(wslenv_value.contains("PORT"));
    }

    const APP_DATA: &str = "/home/me/.local/share/devhub";
    const DURABLE: &str = "/home/me/.local/share/devhub/paseo/runtime/node";

    fn old_unit() -> String {
        [
            "[Service]",
            "WorkingDirectory=/home/me/.local/share/devhub/paseo",
            "Environment=\"PATH=/home/me/.local/share/devhub/tools/bin:/home/me/.local/share/devhub/runtime/abc123/runtime:/home/me/.nvm/bin:/usr/bin\"",
            "Environment=\"PASEO_HOME=/home/me/.local/share/devhub/paseo/home\"",
            "Environment=\"NPM_CONFIG_PREFIX=/home/me/.local/share/devhub/tools\"",
            "Environment=\"npm_config_prefix=/home/me/.local/share/devhub/tools\"",
            "ExecStart=\"/home/me/.local/share/devhub/runtime/abc123/runtime/node\" \"--disable-warning=DEP0040\" \"/x/paseo\" \"daemon\"",
            "Restart=on-failure",
            "",
        ]
        .join("\n")
    }

    #[test]
    fn paseo_unit_moves_off_a_versioned_payload() {
        let unit = old_unit();
        assert_eq!(
            paseo_exec_binary(&unit).as_deref(),
            Some("/home/me/.local/share/devhub/runtime/abc123/runtime/node")
        );
        let fixed = rewrite_paseo_unit(&unit, APP_DATA, DURABLE).expect("needs repair");
        assert_eq!(paseo_exec_binary(&fixed).as_deref(), Some(DURABLE));
        assert!(fixed.contains(
            "ExecStart=\"/home/me/.local/share/devhub/paseo/runtime/node\" \"--disable-warning=DEP0040\" \"/x/paseo\" \"daemon\""
        ));
        assert!(!fixed.contains("/runtime/abc123"));
    }

    #[test]
    fn paseo_unit_stops_handing_the_npm_prefix_to_terminals() {
        let fixed = rewrite_paseo_unit(&old_unit(), APP_DATA, DURABLE).unwrap();
        assert!(!fixed.to_ascii_lowercase().contains("npm_config_prefix"));
        // Everything else the unit carried is kept.
        assert!(fixed.contains("PASEO_HOME=/home/me/.local/share/devhub/paseo/home"));
        assert!(fixed.contains("Restart=on-failure"));
    }

    #[test]
    fn paseo_unit_path_drops_payload_dirs_and_demotes_tools_bin() {
        let fixed = rewrite_paseo_unit(&old_unit(), APP_DATA, DURABLE).unwrap();
        assert!(fixed.contains(
            "Environment=\"PATH=/home/me/.nvm/bin:/usr/bin:/home/me/.local/share/devhub/tools/bin\""
        ));
    }

    #[test]
    fn paseo_unit_keeps_a_user_chosen_npm_prefix() {
        let unit = old_unit().replace(
            "NPM_CONFIG_PREFIX=/home/me/.local/share/devhub/tools",
            "NPM_CONFIG_PREFIX=/home/me/my-global",
        );
        let fixed = rewrite_paseo_unit(&unit, APP_DATA, DURABLE).unwrap();
        assert!(fixed.contains("NPM_CONFIG_PREFIX=/home/me/my-global"));
    }

    #[test]
    fn paseo_unit_already_durable_is_left_alone() {
        let fixed = rewrite_paseo_unit(&old_unit(), APP_DATA, DURABLE).unwrap();
        assert_eq!(rewrite_paseo_unit(&fixed, APP_DATA, DURABLE), None);
    }

    #[test]
    fn paseo_unit_survives_quoted_paths_with_spaces() {
        let app_data = "/home/my user/.local/share/devhub";
        let durable = paseo_durable_node(app_data);
        let unit = format!(
            "ExecStart=\"{app_data}/runtime/abc/runtime/node\" \"--x\"\nEnvironment=\"PATH={app_data}/runtime/abc/runtime:/usr/bin\"\n"
        );
        let fixed = rewrite_paseo_unit(&unit, app_data, &durable).unwrap();
        assert_eq!(paseo_exec_binary(&fixed).as_deref(), Some(durable.as_str()));
        assert!(fixed.contains("Environment=\"PATH=/usr/bin\""));
    }

    #[test]
    fn paseo_unit_without_an_exec_line_has_no_binary() {
        assert_eq!(paseo_exec_binary("[Service]\nRestart=no\n"), None);
        assert_eq!(
            rewrite_paseo_unit("[Service]\nRestart=no\n", APP_DATA, DURABLE),
            None
        );
    }

    #[test]
    fn reuses_last_fallback_ports_when_the_defaults_are_taken() {
        let busy = |port: u16| port != 1337 && port != 1339;
        assert_eq!(
            select_ports_preferring([1337, 1339], Some([1338, 1341]), [true, true], busy),
            Ok([1338, 1341])
        );
        // Defaults free: the default origin wins, whatever was used before.
        assert_eq!(
            select_ports_preferring([1337, 1339], Some([1338, 1341]), [true, true], |_| true),
            Ok([1337, 1339])
        );
        // The remembered ports are taken too: fall back to a fresh search.
        assert_eq!(
            select_ports_preferring([1337, 1339], Some([1338, 1341]), [true, true], |port| port
                == 1340
                || port == 1342),
            Ok([1340, 1342])
        );
        // Pinned ports are never second-guessed.
        assert!(
            select_ports_preferring([1337, 1339], Some([1338, 1341]), [false, true], busy).is_err()
        );
    }

    #[test]
    fn parses_only_well_formed_saved_ports() {
        assert_eq!(parse_saved_ports("1338 1341\n"), Some([1338, 1341]));
        assert_eq!(parse_saved_ports("1338"), None);
        assert_eq!(parse_saved_ports("1338 1338"), None);
        assert_eq!(parse_saved_ports("1338 1341 9"), None);
        assert_eq!(parse_saved_ports("abc def"), None);
        assert_eq!(parse_saved_ports("0 5"), None);
    }

    fn shares_content(own: Option<&str>, service: Option<&str>) -> bool {
        content_sharing(own, service).0
    }

    #[test]
    fn only_defers_scheduled_jobs_when_the_content_is_shared() {
        assert!(
            !shares_content(None, Some("/home/me/dev/devhub")),
            "fresh app data has its own jobs"
        );
        assert!(!shares_content(
            Some("/home/me/other"),
            Some("/home/me/dev/devhub")
        ));
        assert!(shares_content(
            Some("/home/me/dev/devhub/"),
            Some("/home/me/dev/devhub")
        ));
        assert!(
            shares_content(Some("/home/me/dev/devhub"), None),
            "unknown service: stay safe"
        );
        assert!(!shares_content(None, None));
    }

    #[test]
    fn finds_the_checkout_behind_a_dev_service() {
        // `next start` inside dashboard/
        assert_eq!(
            service_repo_root("/home/me/dev/devhub/dashboard\n").as_deref(),
            Some("/home/me/dev/devhub")
        );
        // `npm start` at the repo root
        assert_eq!(
            service_repo_root("/home/me/dev/devhub-private\n").as_deref(),
            Some("/home/me/dev/devhub-private")
        );
        assert_eq!(
            service_repo_root("/home/me/dev/devhub/").as_deref(),
            Some("/home/me/dev/devhub")
        );
        assert_eq!(service_repo_root(""), None);
        assert_eq!(service_repo_root("/"), None);
        assert_eq!(service_repo_root("relative/dir"), None);
    }

    #[test]
    fn a_root_layout_service_on_another_repo_does_not_disable_the_scheduler() {
        // The real unit: WorkingDirectory=<repo>, ExecStart=npm start.
        let service = service_repo_root("/home/me/dev/devhub-private");
        let linked = Some("/home/me/devhub-wizard/create");
        let (shared, reason) = content_sharing(linked, service.as_deref());
        assert!(!shared, "a different repo has its own jobs");
        assert!(reason.contains("different"));
    }

    #[test]
    fn both_service_layouts_defer_only_for_the_same_repo() {
        for working_directory in ["/home/me/dev/devhub", "/home/me/dev/devhub/dashboard"] {
            let service = service_repo_root(working_directory);
            assert!(shares_content(
                Some("/home/me/dev/devhub"),
                service.as_deref()
            ));
            assert!(!shares_content(
                Some("/home/me/dev/other"),
                service.as_deref()
            ));
        }
    }

    #[test]
    fn paseo_log_says_what_actually_changed() {
        let durable = paseo_durable_node("/home/me/.local/share/devhub");
        assert_eq!(
            describe_paseo_repair(&durable, &durable),
            "[paseo] cleaned the Paseo service environment (npm prefix, payload PATH)"
        );
        let moved = describe_paseo_repair(
            "/home/me/.local/share/devhub/runtime/abc/runtime/node",
            &durable,
        );
        assert!(moved.starts_with("[paseo] moved the Paseo service off "));
        assert!(moved.contains("runtime/abc"));
    }

    #[test]
    fn paseo_restart_marker_matches_the_dashboard() {
        assert_eq!(
            paseo_restart_marker("/home/me/.local/share/devhub"),
            "/home/me/.local/share/devhub/paseo/restart-pending"
        );
    }

    #[test]
    fn paseo_unit_lives_in_the_users_systemd_dir() {
        assert_eq!(
            paseo_unit_path("/home/me/"),
            "/home/me/.config/systemd/user/devhub-paseo.service"
        );
    }
}
