//! Who is holding a port DevHub wants, and what it may do about it.
//!
//! The Windows app runs its server inside WSL. A reinstall (or a crash) can
//! leave the previous build's supervisor running there, holding the ports the
//! new build wants. That is DevHub's own leftover and is worth offering to
//! stop. Everything else on a port — the user's `devhub.service`, the Paseo
//! daemon, any other program — is not ours: it is named and left alone, and
//! DevHub starts on other ports instead.
//!
//! Ownership is decided from the process (command line, working directory and
//! systemd cgroup), never from the port alone. The classifiers are pure so the
//! never-kill rules are unit-tested on every platform.

use std::time::Duration;

use crate::wsl::WslBackend;

/// What kind of process holds the port.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HolderKind {
    /// The supervisor or a child of it, unpacked under this app's runtime
    /// folder and not part of any systemd service. The only kind we may stop.
    OwnSidecar,
    /// A previous instance of this app's own Windows executable.
    #[cfg_attr(not(windows), allow(dead_code))]
    OwnApp,
    /// The user's `devhub.service`.
    DevhubService,
    /// The managed Paseo daemon.
    Paseo,
    /// Anything else.
    Other,
}

impl HolderKind {
    /// The one rule that matters: only DevHub's own app processes may be stopped.
    pub fn may_stop(self) -> bool {
        matches!(self, HolderKind::OwnSidecar | HolderKind::OwnApp)
    }

    fn describe(self) -> &'static str {
        match self {
            HolderKind::OwnSidecar => "a previous DevHub server left running",
            HolderKind::OwnApp => "a previous DevHub window",
            HolderKind::DevhubService => "your devhub.service",
            HolderKind::Paseo => "the Paseo agent service",
            HolderKind::Other => "another program",
        }
    }
}

/// Where the process lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Wsl,
    #[cfg_attr(not(windows), allow(dead_code))]
    Windows,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Holder {
    pub port: u16,
    pub pid: u32,
    pub kind: HolderKind,
    pub side: Side,
    pub command: String,
}

/// Classify a process inside the distro.
pub fn classify_wsl_holder(app_data: &str, command: &str, cwd: &str, cgroup: &str) -> HolderKind {
    // A systemd service is never ours to stop, whatever its command line says.
    if cgroup.contains("devhub-paseo.service") || command.contains("/paseo/") {
        return HolderKind::Paseo;
    }
    if cgroup.contains("devhub.service") {
        return HolderKind::DevhubService;
    }
    if cgroup.contains(".service") {
        return HolderKind::Other;
    }
    let runtime = format!("{}/runtime/", app_data.trim_end_matches('/'));
    if command.contains(&runtime) || cwd.starts_with(&runtime) {
        return HolderKind::OwnSidecar;
    }
    HolderKind::Other
}

/// Classify a Windows process by the executable's path. Ours only when it is
/// DevHub's executable inside this install folder, and never the running shell.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn classify_windows_holder(
    install_dir: &str,
    exe_path: &str,
    pid: u32,
    own_pid: u32,
) -> HolderKind {
    if pid == own_pid || exe_path.is_empty() {
        return HolderKind::Other;
    }
    let norm = |p: &str| p.replace('/', "\\").to_ascii_lowercase();
    let dir = norm(install_dir);
    let dir = format!("{}\\", dir.trim_end_matches('\\'));
    let exe = norm(exe_path);
    if exe.starts_with(&dir) && exe.ends_with("devhub-desktop.exe") {
        HolderKind::OwnApp
    } else {
        HolderKind::Other
    }
}

/// Finds the processes with a listening socket on `$1`. Output, one per line:
/// `HOLDER<TAB>pid<TAB>cwd<TAB>cgroup<TAB>command`.
pub const WSL_HOLDER_SCRIPT: &str = r#"
port="$1"
hex=$(printf '%04X' "$port")
inodes=$(cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk -v h="$hex" '$4=="0A" && substr($2, length($2)-3)==h {print $10}')
[ -n "$inodes" ] || exit 0
ls -l /proc/[0-9]*/fd 2>/dev/null | awk -v want="$inodes" '
  BEGIN { n = split(want, a, " "); for (i = 1; i <= n; i++) w["socket:[" a[i] "]"] = 1 }
  /^\/proc\/[0-9]+\/fd:$/ { split($0, p, "/"); pid = p[3] }
  /->/ { if (($NF) in w) print pid }' | sort -u | while read -r pid; do
  [ -n "$pid" ] || continue
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
  cg=$(tr '\n' ';' < "/proc/$pid/cgroup" 2>/dev/null || true)
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  printf 'HOLDER\t%s\t%s\t%s\t%s\n' "$pid" "$cwd" "$cg" "$cmd"
done
"#;

pub fn parse_wsl_holders(port: u16, app_data: &str, output: &str) -> Vec<Holder> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(5, '\t');
            if fields.next()? != "HOLDER" {
                return None;
            }
            let pid: u32 = fields.next()?.trim().parse().ok()?;
            let cwd = fields.next()?;
            let cgroup = fields.next()?;
            let command = fields.next().unwrap_or("").trim().to_string();
            Some(Holder {
                port,
                pid,
                kind: classify_wsl_holder(app_data, &command, cwd, cgroup),
                side: Side::Wsl,
                command,
            })
        })
        .collect()
}

/// `pid<TAB>exe path<TAB>command line`, one per line.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_windows_holders(
    port: u16,
    install_dir: &str,
    own_pid: u32,
    output: &str,
) -> Vec<Holder> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(3, '\t');
            let pid: u32 = fields.next()?.trim().parse().ok()?;
            let exe = fields.next().unwrap_or("").trim();
            let command = fields.next().unwrap_or("").trim();
            Some(Holder {
                port,
                pid,
                kind: classify_windows_holder(install_dir, exe, pid, own_pid),
                side: Side::Windows,
                command: if command.is_empty() { exe } else { command }.to_string(),
            })
        })
        .collect()
}

/// Holders in the distro for one port. Errors read as "unknown", not "free".
pub fn wsl_holders(backend: &WslBackend, port: u16) -> Vec<Holder> {
    let port_arg = port.to_string();
    backend
        .exec(
            &[
                "/bin/sh",
                "-c",
                WSL_HOLDER_SCRIPT,
                "devhub-port-holder",
                &port_arg,
            ],
            Duration::from_secs(15),
        )
        .map(|out| parse_wsl_holders(port, &backend.app_data, &out))
        .unwrap_or_default()
}

/// Windows processes listening on `port` (other than the WSL relay's own
/// forwarding, which shows up as a WSL holder instead).
pub fn windows_holders(port: u16, install_dir: &str) -> Vec<Holder> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let script = format!(
            "$ErrorActionPreference='SilentlyContinue'; Get-NetTCPConnection -State Listen -LocalPort {port} | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {{ $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$_\"; \"$($p.ProcessId)`t$($p.ExecutablePath)`t$($p.CommandLine)\" }}"
        );
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .output();
        return match output {
            Ok(out) => parse_windows_holders(
                port,
                install_dir,
                std::process::id(),
                &String::from_utf8_lossy(&out.stdout),
            ),
            Err(_) => Vec::new(),
        };
    }
    #[cfg(not(windows))]
    {
        let _ = (port, install_dir);
        Vec::new()
    }
}

/// `1337 (pid 4123: node …)` — enough to recognise it.
pub fn describe(holder: &Holder) -> String {
    let command: String = holder.command.chars().take(100).collect();
    format!(
        "port {} is held by {} (pid {}{})",
        holder.port,
        holder.kind.describe(),
        holder.pid,
        if command.is_empty() {
            String::new()
        } else {
            format!(": {command}")
        }
    )
}

/// What to do about the holders of the ports DevHub wants.
#[derive(Debug, PartialEq, Eq)]
pub struct ClashPlan {
    /// DevHub's own leftovers: the user may be offered to stop these.
    pub stoppable: Vec<Holder>,
    /// Everything else: named in the log and the message, never touched.
    pub others: Vec<Holder>,
}

pub fn plan_clash(holders: Vec<Holder>) -> ClashPlan {
    let (stoppable, others) = holders.into_iter().partition(|h| h.kind.may_stop());
    ClashPlan { stoppable, others }
}

/// The question put to the user for DevHub's own leftovers.
pub fn free_the_port_prompt(stoppable: &[Holder]) -> String {
    let lines = stoppable
        .iter()
        .map(describe)
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "DevHub is already running in the background from an earlier start, and it is holding the ports DevHub wants:\n\n{lines}\n\nFree the port stops only that DevHub process. Or DevHub can use other ports."
    )
}

/// When pinned ports (DEVHUB_PORT) can't be fallen back from, say who holds them.
pub fn pinned_conflict_message(base: &str, plan: &ClashPlan) -> String {
    let named: Vec<String> = plan
        .stoppable
        .iter()
        .chain(&plan.others)
        .map(describe)
        .collect();
    if named.is_empty() {
        base.to_string()
    } else {
        format!("{base}\n{}", named.join("\n"))
    }
}

/// Stop DevHub's own holders, and only those.
///
/// Every holder is looked up again immediately before it is signalled, so a pid
/// that has been reused by another program since the dialog was shown is never
/// hit. Returns the pids that were signalled.
pub fn stop_own_holders(backend: &WslBackend, install_dir: &str, planned: &[Holder]) -> Vec<u32> {
    let mut stopped = Vec::new();
    for holder in planned.iter().filter(|h| h.kind.may_stop()) {
        let fresh = match holder.side {
            Side::Wsl => wsl_holders(backend, holder.port),
            Side::Windows => windows_holders(holder.port, install_dir),
        };
        let Some(current) = fresh
            .iter()
            .find(|h| h.pid == holder.pid && h.kind.may_stop())
        else {
            continue;
        };
        let pid = current.pid.to_string();
        let ok = match current.side {
            Side::Wsl => {
                // The supervisor takes its children (Next, the PTY server) down
                // with it; signalling the listener alone would leave a parent
                // that restarts it.
                let pattern = format!(
                    "{}/runtime/[^ /]+/services/supervisor\\.mjs",
                    backend.app_data.trim_end_matches('/').replace('.', "\\.")
                );
                let _ = backend.exec(
                    &["/usr/bin/pkill", "-TERM", "-f", &pattern],
                    Duration::from_secs(10),
                );
                backend
                    .exec(&["/bin/kill", "-TERM", &pid], Duration::from_secs(10))
                    .is_ok()
            }
            Side::Windows => stop_windows_process(current.pid),
        };
        if ok {
            stopped.push(current.pid);
        }
    }
    stopped
}

fn stop_windows_process(pid: u32) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        return std::process::Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP_DATA: &str = "/home/me/.local/share/devhub";

    fn holder(kind: HolderKind, pid: u32) -> Holder {
        Holder {
            port: 1337,
            pid,
            kind,
            side: Side::Wsl,
            command: "node".into(),
        }
    }

    #[test]
    fn a_leftover_sidecar_from_this_app_is_ours() {
        let command = "/home/me/.local/share/devhub/runtime/48f7/runtime/node /home/me/.local/share/devhub/runtime/48f7/services/supervisor.mjs";
        assert_eq!(
            classify_wsl_holder(
                APP_DATA,
                command,
                "/home/me/.local/share/devhub/runtime/48f7/server",
                "0::/init.scope;"
            ),
            HolderKind::OwnSidecar
        );
        // Next's worker only shows `next-server`; its working directory gives it away.
        assert_eq!(
            classify_wsl_holder(
                APP_DATA,
                "next-server (v15)",
                "/home/me/.local/share/devhub/runtime/48f7/server",
                "0::/init.scope;"
            ),
            HolderKind::OwnSidecar
        );
    }

    #[test]
    fn the_users_devhub_service_is_never_ours_even_from_the_apps_folder() {
        let cgroup = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/devhub.service;";
        for command in [
            "npm start",
            "next-server (v15)",
            "/home/me/.local/share/devhub/runtime/48f7/runtime/node /home/me/.local/share/devhub/runtime/48f7/services/supervisor.mjs",
        ] {
            let kind = classify_wsl_holder(APP_DATA, command, "/home/me/dev/devhub-private/dashboard", cgroup);
            assert_eq!(kind, HolderKind::DevhubService, "{command}");
            assert!(!kind.may_stop());
        }
    }

    #[test]
    fn paseo_is_never_ours() {
        let cgroup = "0::/user.slice/user@1000.service/app.slice/devhub-paseo.service;";
        let kind = classify_wsl_holder(
            APP_DATA,
            "/home/me/.local/share/devhub/paseo/runtime/node /x/paseo daemon",
            "/home/me",
            cgroup,
        );
        assert_eq!(kind, HolderKind::Paseo);
        assert!(!kind.may_stop());
        // Even without the cgroup, anything running from the paseo folder is Paseo's.
        assert_eq!(
            classify_wsl_holder(
                APP_DATA,
                "/home/me/.local/share/devhub/paseo/runtime/node d.js",
                "/home/me",
                "0::/init.scope;"
            ),
            HolderKind::Paseo
        );
    }

    #[test]
    fn unrelated_and_other_services_are_left_alone() {
        for (command, cwd, cgroup) in [
            (
                "python3 -m http.server 1337",
                "/home/me/site",
                "0::/init.scope;",
            ),
            (
                "node server.js",
                "/home/me/other-app",
                "0::/user.slice/user@1000.service/app.slice/openchamber.service;",
            ),
            // Looks like DevHub's folder, but it is a service: not ours.
            (
                "node x.js",
                "/home/me/.local/share/devhub/runtime/1/server",
                "0::/user.slice/user@1000.service/app.slice/something.service;",
            ),
            ("", "", ""),
        ] {
            let kind = classify_wsl_holder(APP_DATA, command, cwd, cgroup);
            assert_eq!(kind, HolderKind::Other, "{command} {cgroup}");
            assert!(!kind.may_stop());
        }
    }

    #[test]
    fn a_similarly_named_folder_is_not_the_apps_runtime() {
        assert_eq!(
            classify_wsl_holder(
                APP_DATA,
                "node x.js",
                "/home/me/.local/share/devhub-other/runtime/1/server",
                "0::/init.scope;"
            ),
            HolderKind::Other
        );
        assert_eq!(
            classify_wsl_holder(
                APP_DATA,
                "node /home/me/.local/share/devhub/runtime-old/x.js",
                "/home/me",
                "0::/init.scope;"
            ),
            HolderKind::Other
        );
    }

    #[test]
    fn only_devhubs_own_windows_exe_in_this_install_is_ours() {
        let dir = "C:\\Users\\me\\AppData\\Local\\DevHub";
        assert_eq!(
            classify_windows_holder(
                dir,
                "C:\\Users\\me\\AppData\\Local\\DevHub\\devhub-desktop.exe",
                4100,
                9
            ),
            HolderKind::OwnApp
        );
        // The shell itself, another install, a WSL relay and an unknown owner: never.
        assert_eq!(
            classify_windows_holder(
                dir,
                "C:\\Users\\me\\AppData\\Local\\DevHub\\devhub-desktop.exe",
                9,
                9
            ),
            HolderKind::Other
        );
        assert_eq!(
            classify_windows_holder(dir, "D:\\Other\\DevHub\\devhub-desktop.exe", 4100, 9),
            HolderKind::Other
        );
        assert_eq!(
            classify_windows_holder(dir, "C:\\Windows\\System32\\wslrelay.exe", 4100, 9),
            HolderKind::Other
        );
        assert_eq!(classify_windows_holder(dir, "", 4100, 9), HolderKind::Other);
        assert_eq!(
            classify_windows_holder(
                dir,
                "C:\\Users\\me\\AppData\\Local\\DevHub-evil\\devhub-desktop.exe",
                4100,
                9
            ),
            HolderKind::Other
        );
    }

    #[test]
    fn parses_what_the_distro_reports() {
        let output = "HOLDER\t812\t/home/me/.local/share/devhub/runtime/48f7/server\t0::/init.scope;\tnext-server (v15) \nHOLDER\t77\t/home/me/dev/devhub-private/dashboard\t0::/user.slice/user@1000.service/app.slice/devhub.service;\tnpm start \nnoise\n";
        let holders = parse_wsl_holders(1337, APP_DATA, output);
        assert_eq!(holders.len(), 2);
        assert_eq!(
            (holders[0].pid, holders[0].kind),
            (812, HolderKind::OwnSidecar)
        );
        assert_eq!(
            (holders[1].pid, holders[1].kind),
            (77, HolderKind::DevhubService)
        );
        assert_eq!(holders[1].command, "npm start");
    }

    #[test]
    fn parses_windows_owners() {
        let dir = "C:\\Apps\\DevHub";
        let output = "5120\tC:\\Apps\\DevHub\\devhub-desktop.exe\t\"C:\\Apps\\DevHub\\devhub-desktop.exe\"\n6000\tC:\\Tools\\thing.exe\tthing.exe --serve\n";
        let holders = parse_windows_holders(1337, dir, 1, output);
        assert_eq!(holders[0].kind, HolderKind::OwnApp);
        assert_eq!(holders[1].kind, HolderKind::Other);
        assert_eq!(holders[1].command, "thing.exe --serve");
    }

    #[test]
    fn only_our_own_leftovers_are_offered_for_stopping() {
        let plan = plan_clash(vec![
            holder(HolderKind::OwnSidecar, 1),
            holder(HolderKind::DevhubService, 2),
            holder(HolderKind::Paseo, 3),
            holder(HolderKind::Other, 4),
            holder(HolderKind::OwnApp, 5),
        ]);
        assert_eq!(
            plan.stoppable.iter().map(|h| h.pid).collect::<Vec<_>>(),
            vec![1, 5]
        );
        assert_eq!(
            plan.others.iter().map(|h| h.pid).collect::<Vec<_>>(),
            vec![2, 3, 4]
        );
        assert!(plan.stoppable.iter().all(|h| h.kind.may_stop()));
        assert!(plan.others.iter().all(|h| !h.kind.may_stop()));
    }

    #[test]
    fn the_prompt_and_messages_name_the_process() {
        let own = holder(HolderKind::OwnSidecar, 812);
        let prompt = free_the_port_prompt(std::slice::from_ref(&own));
        assert!(prompt.contains("pid 812"));
        assert!(prompt.contains("a previous DevHub server left running"));
        let plan = plan_clash(vec![holder(HolderKind::DevhubService, 77)]);
        let message = pinned_conflict_message("Requested ports are in use: dashboard 1337.", &plan);
        assert!(message.contains("your devhub.service (pid 77"));
        assert_eq!(
            pinned_conflict_message("base", &plan_clash(Vec::new())),
            "base"
        );
    }

    #[test]
    fn a_foreign_holder_means_fallback_ports_not_a_dialog() {
        use crate::wsl::select_ports_preferring;
        let plan = plan_clash(vec![holder(HolderKind::DevhubService, 77)]);
        assert!(plan.stoppable.is_empty(), "nothing to offer to stop");
        // Defaults taken by the service; the saved fallbacks are free and come first.
        let taken = [1337_u16, 1339];
        let free = |port: u16| !taken.contains(&port);
        assert_eq!(
            select_ports_preferring([1337, 1339], Some([1338, 1341]), [true, true], free).unwrap(),
            [1338, 1341]
        );
        // The saved fallbacks are held too: a fresh free pair is chosen, never an error.
        let taken = [1337_u16, 1339, 1338];
        let free = |port: u16| !taken.contains(&port);
        let chosen =
            select_ports_preferring([1337, 1339], Some([1338, 1341]), [true, true], free).unwrap();
        assert!(chosen.iter().all(|p| !taken.contains(p)));
        assert_ne!(chosen[0], chosen[1]);
    }
}
