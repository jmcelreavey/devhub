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

    /// Content-only Git linking keeps configuration in app data. Auto-detecting
    /// that clone as a legacy checkout would switch to an absent .env.local.
    pub fn has_content_checkout(&self) -> bool {
        self.exec(
            &[
                "/bin/test",
                "-s",
                &format!("{}/content-repo-path.txt", self.app_data),
            ],
            QUICK_TIMEOUT,
        )
        .is_ok()
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

    /// Unpack the bundled payload into the distro, then drop older builds.
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
for old in "$root"/*; do
  [ "$old" = "$root/$id" ] || rm -rf "$old"
done
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
}
