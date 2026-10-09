//! Sidecar lifecycle: start one process group, wait for authenticated health,
//! stop only what we started.
//!
//! The two rules this module exists to enforce:
//!
//! 1. **Never kill by port.** The Electron launcher scanned for listeners on
//!    1337/1339 and killed them. On a developer's machine those ports belong to
//!    a person's own dev server about as often as they belong to DevHub, and
//!    "the launcher killed my build" is not a recoverable first impression. We
//!    kill a process group we created and nothing else.
//!
//! 2. **Never trust a port.** Something answering on 1337 is not DevHub. The
//!    shell asks `/api/desktop/health` with the per-launch bootstrap token and
//!    believes only a correct answer.

use std::io::{BufRead, BufReader};
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::logging::DesktopLog;
use crate::paths::{sidecar_env, sidecar_env_for, RuntimePaths, SidecarDirs};
use crate::wsl::WslBackend;

/// Startup as an explicit state machine.
///
/// Modelled explicitly because the alternative — a blank window until something
/// happens — is what the old launcher did, and a blank window is
/// indistinguishable from a hang. Each variant maps to something the boot page
/// can actually say.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum BootState {
    Preparing,
    Starting {
        service: String,
    },
    Ready {
        url: String,
    },
    Failed {
        error: String,
        logs: Vec<String>,
        /// A leftover DevHub dev server from this checkout is holding our port,
        /// and stopping it is a thing the shell can safely offer to do.
        ///
        /// Carried on the state rather than parsed back out of the message,
        /// because the boot page deciding whether to show a process-killing
        /// button by string-matching an error sentence is a bug waiting for
        /// somebody to reword the sentence.
        #[serde(default)]
        stoppable_dev_server: bool,
        #[serde(default)]
        install_wsl: bool,
    },
    Stopping,
}

/// Set when the sidecar runs inside WSL rather than as a native child.
#[derive(Clone)]
struct WslLaunch {
    backend: WslBackend,
    payload_dir: String,
}

pub struct Sidecar {
    child: Arc<Mutex<Option<Child>>>,
    wsl: Mutex<Option<WslLaunch>>,
    log: DesktopLog,
    ports: Mutex<[u16; 2]>,
    pub preferred_ports: [u16; 2],
    pub token: String,
}

/// Is anything listening?
///
/// A connect attempt, not a bind attempt: binding to test a port and then
/// releasing it races anything else starting up in that window.
pub fn port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_millis(250),
    )
    .is_ok()
}

/// Does the thing on this port claim to be *our* desktop DevHub?
///
/// Requires the per-launch token, so a previous DevHub instance, another user's
/// instance, or a malicious local server all fail this check. Without it a
/// second launch would happily adopt whatever was listening.
///
/// `desktop: true` is required as well as `devhub: true`, and that is not
/// belt-and-braces. The health route answers unauthenticated callers with
/// `{devhub: true, desktop: false}` so a browser-mode dashboard can report
/// itself — which means a bare `next start` from this checkout passed a check
/// whose entire purpose was to be unforgeable. It read as "our DevHub is
/// already up" to a shell that had never started it.
pub fn health_check(port: u16, token: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_millis(500),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    use std::io::Write;
    let request = format!(
        "GET /api/desktop/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-DevHub-Token: {token}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    use std::io::Read;
    let mut response = Vec::with_capacity(1024);
    let mut chunk = [0; 1024];
    let mut status_ok = false;
    loop {
        let read = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return false,
            Ok(read) => read,
        };
        response.extend_from_slice(&chunk[..read]);

        let response = String::from_utf8_lossy(&response);
        if let Some(status_end) = response.find("\r\n") {
            if !response[..status_end].starts_with("HTTP/1.1 200") {
                return false;
            }
            status_ok = true;
        }
        if status_ok
            && response.contains("\"devhub\":true")
            && response.contains("\"desktop\":true")
        {
            return true;
        }
        // Next responds with chunked keep-alive connections. Waiting for EOF
        // here turns a healthy server into a startup timeout.
        if response.len() >= 16 * 1024 {
            return false;
        }
    }
}

/// The installed payload a checkout rebuild copies its Node runtime from.
/// Empty `id` means there is no installed payload to build against.
pub(crate) struct BasePayload<'a> {
    pub dir: &'a str,
    pub id: &'a str,
}

/// How this instance relates to a DevHub already running in the distro.
pub(crate) struct Coexistence<'a> {
    /// Another service owns the same scheduled jobs, so ours stay off.
    pub secondary: bool,
    /// `DEVHUB_STATE_PROFILE`, when run history and logs must not be shared.
    pub state_profile: Option<&'a str>,
}

impl Sidecar {
    pub fn new(port: u16, terminal_port: u16, token: String, log: DesktopLog) -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            wsl: Mutex::new(None),
            log,
            ports: Mutex::new([port, terminal_port]),
            preferred_ports: [port, terminal_port],
            token,
        }
    }

    pub fn ports(&self) -> [u16; 2] {
        *self.ports.lock().unwrap()
    }

    pub fn port(&self) -> u16 {
        self.ports()[0]
    }

    pub fn configure_ports(&self, ports: [u16; 2]) {
        *self.ports.lock().unwrap() = ports;
    }

    /// The WSL distro the sidecar runs in, once started there.
    pub fn wsl_backend(&self) -> Option<WslBackend> {
        self.wsl
            .lock()
            .ok()
            .and_then(|w| w.as_ref().map(|l| l.backend.clone()))
    }

    /// Refuse to start into an occupied port.
    ///
    /// Returning the port rather than resolving it is the point. The only safe
    /// automatic resolution is "use a different port", and silently moving the
    /// port breaks every bookmark and every integration callback URL. The user
    /// gets told, with the two honest choices.
    ///
    /// *Who* holds the port is left to the caller, which decides from the
    /// process rather than from the reply. Asking the port was rule 2 breaking
    /// itself: an orphaned checkout server answered "DevHub" convincingly
    /// enough that the shell reported a second app, sent the user off to quit a
    /// window that did not exist, and hid its own offer to clear the leftover.
    pub fn check_ports(&self) -> Option<u16> {
        self.ports().into_iter().find(|port| port_in_use(*port))
    }

    /// Spawn the supervisor in its own process group.
    ///
    /// The group is what makes shutdown correct: Next forks workers, the PTY
    /// server spawns shells, and those shells spawn whatever the user runs. A
    /// group leader gives us one handle for that entire tree.
    pub fn start<F>(&self, paths: &RuntimePaths, on_event: F) -> std::io::Result<()>
    where
        F: FnMut(BootState) + Send + 'static,
    {
        let [port, terminal_port] = self.ports();
        let env = sidecar_env(paths, port, terminal_port, &self.token);
        let supervisor = paths.supervisor();

        let mut cmd = Command::new(&paths.node_bin);
        cmd.arg(&supervisor)
            .current_dir(&paths.server_dir)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // A GUI-launched process has a minimal PATH, and the terminal, agent
        // CLIs, and git all need a real one. Inheriting selectively rather than
        // wholesale keeps npm/Next lifecycle noise out of the child.
        for key in [
            "PATH",
            "HOME",
            "USER",
            "LANG",
            "SHELL",
            "TMPDIR",
            "XDG_DATA_HOME",
            // The self-test sets this so its throwaway server never runs the
            // user's scheduled jobs; also lets a user turn the scheduler off.
            "DEVHUB_SCHEDULER",
        ] {
            if let Some(value) = std::env::var_os(key) {
                cmd.env(key, value);
            }
        }
        for (key, value) in &env {
            cmd.env(key, value);
        }

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // New process group, so `killpg` reaches every descendant and
            // nothing else. Also detaches the child from the terminal's
            // signals, which otherwise deliver SIGINT to it directly.
            unsafe {
                cmd.pre_exec(|| {
                    if libc_setsid() == -1 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }

        self.spawn_and_pump(cmd, on_event)
    }

    /// Start the supervisor inside a WSL distro (Windows builds).
    ///
    /// Same protocol as [`Sidecar::start`] — one JSON state line per event on
    /// stdout, stdin held open as the orphan guard — with `wsl.exe` as the
    /// transport. Closing our end of stdin is how `stop` asks it to leave.
    pub fn start_wsl<F>(
        &self,
        backend: &WslBackend,
        payload: &str,
        checkout: Option<&str>,
        coexistence: Coexistence<'_>,
        base: BasePayload<'_>,
        on_event: F,
    ) -> std::io::Result<()>
    where
        F: FnMut(BootState) + Send + 'static,
    {
        let [port, terminal_port] = self.ports();
        let mut env = sidecar_env_for(
            &SidecarDirs {
                app_data: backend.app_data.clone(),
                resource_root: format!("{payload}/resources"),
                server_dir: format!("{payload}/server"),
                checkout: checkout.map(str::to_string),
                state_profile: coexistence.state_profile.map(str::to_string),
            },
            port,
            terminal_port,
            &self.token,
        );
        // Not part of the shared builder: the native path does not set it
        // either, and the health route reports `null` there. Cheap to have
        // right here, where the shell and the server are versioned separately.
        env.insert("DEVHUB_VERSION".into(), env!("CARGO_PKG_VERSION").into());
        if !base.id.is_empty() {
            env.insert("DEVHUB_BASE_PAYLOAD_DIR".into(), base.dir.to_string());
            env.insert("DEVHUB_BASE_PAYLOAD_ID".into(), base.id.to_string());
        }
        if coexistence.secondary {
            // The existing dev service may already own the same scheduled jobs.
            env.insert("DEVHUB_SCHEDULER".into(), "0".into());
        }
        *self.wsl.lock().unwrap() = Some(WslLaunch {
            backend: backend.clone(),
            payload_dir: payload.to_string(),
        });
        self.spawn_and_pump(backend.sidecar_command(payload, &env), on_event)
    }

    fn spawn_and_pump<F>(&self, mut cmd: Command, mut on_event: F) -> std::io::Result<()>
    where
        F: FnMut(BootState) + Send + 'static,
    {
        let mut child = cmd.spawn()?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let log_out = self.log.clone();
        let log_err = self.log.clone();

        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    log_err.write_line("sidecar:stderr", &line);
                }
            });
        }

        if let Some(stdout) = stdout {
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    log_out.write_line("sidecar:stdout", &line);
                    // The supervisor emits one JSON object per line for state.
                    // Everything else is Next's own output and is log-only.
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                        if value.get("devhubSidecar").and_then(|v| v.as_bool()) == Some(true) {
                            if let Some(state) = parse_state(&value) {
                                on_event(state);
                            }
                        }
                    }
                }
            });
        }

        *self.child.lock().unwrap() = Some(child);
        Ok(())
    }

    /// Block until the dashboard answers an authenticated health check.
    ///
    /// Deliberately not "until the port opens": a port that accepts connections
    /// before Next can serve a request is exactly how the old launcher produced
    /// a white window.
    pub fn wait_until_healthy(&self, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Ok(mut guard) = self.child.lock() {
                if let Some(child) = guard.as_mut() {
                    if let Ok(Some(status)) = child.try_wait() {
                        return Err(format!("Sidecar exited during startup ({status})"));
                    }
                }
            }
            if health_check(self.port(), &self.token) {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Err(format!(
            "Dashboard did not become healthy within {}s",
            timeout.as_secs()
        ))
    }

    /// Graceful stop, then kill the group we own.
    ///
    /// SIGTERM to the group gives Next time to flush and the PTY server time to
    /// close session logs. SIGKILL is the fallback, still scoped to the group —
    /// there is no path here that touches a PID we did not create.
    pub fn stop(&self) {
        let mut guard = match self.child.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let Some(mut child) = guard.take() else {
            return;
        };
        let pid = child.id();
        self.log
            .write_line("shell", &format!("stopping sidecar group {pid}"));

        // WSL: there is no process group we can signal from Windows. Closing
        // stdin trips the supervisor's orphan guard, which SIGTERMs its own
        // tree; only if that does not finish do we reach in and kill it.
        let wsl = self.wsl.lock().ok().and_then(|mut w| w.take());
        if let Some(wsl) = wsl {
            drop(child.stdin.take());
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            self.log.write_line(
                "shell",
                "supervisor did not exit after stdin closed — killing it inside WSL",
            );
            wsl.backend.kill_supervisor(&wsl.payload_dir);
            let _ = child.kill();
            let _ = child.wait();
            return;
        }

        #[cfg(unix)]
        unsafe {
            libc_killpg(pid as i32, 15); // SIGTERM
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill();
        }

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                _ => break,
            }
        }

        self.log
            .write_line("shell", "sidecar did not exit gracefully — killing group");
        #[cfg(unix)]
        unsafe {
            libc_killpg(pid as i32, 9); // SIGKILL
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    /// The dashboard URL the *window* loads.
    ///
    /// `localhost`, not `127.0.0.1`, and that is load-bearing rather than
    /// cosmetic. WebKit stores a cookie set for the IP literal but will not
    /// send it back on a same-origin `fetch`, so every cookie-authenticated
    /// route 401s. It shipped a completely broken terminal: the client could
    /// not obtain a ticket, so the PTY rejected every connection.
    ///
    /// Verified rather than assumed — the same page against `localhost:1337`
    /// gets 200 where `127.0.0.1:1337` gets 401, with the cookie present in the
    /// jar in both cases.
    ///
    /// The server still *binds* 127.0.0.1; only the name the webview uses
    /// changes. Health checks below keep using the literal because they talk
    /// raw TCP and have no cookies to lose.
    #[allow(dead_code)] // kept for call sites / debugging; handoff uses bootstrap_url()
    pub fn url(&self) -> String {
        format!("http://{}:{}", window_host(), self.port())
    }

    /// The one-shot bootstrap URL that exchanges the token for a cookie.
    pub fn bootstrap_url(&self) -> String {
        format!(
            "http://{}:{}/api/desktop/bootstrap?token={}",
            window_host(),
            self.port(),
            self.token
        )
    }
}

/// The host name the *window* loads the dashboard from.
///
/// `localhost` everywhere except Windows, for the WebKit cookie reason above.
/// On Windows it is the IPv4 literal instead, because WebView2 resolves
/// `localhost` to `::1` first, and the server lives in WSL: its loopback relay
/// forwards IPv4 reliably but is not guaranteed to serve `::1`. The health check
/// (raw IPv4) passed while every WebView2 navigation to `localhost` was
/// cancelled, leaving a window stuck on the boot page. Chromium, unlike WebKit,
/// keeps and sends cookies for an IP-literal host.
fn window_host() -> &'static str {
    if cfg!(windows) {
        "127.0.0.1"
    } else {
        "localhost"
    }
}

fn parse_state(value: &serde_json::Value) -> Option<BootState> {
    match value.get("state")?.as_str()? {
        "preparing" => Some(BootState::Preparing),
        "starting" => Some(BootState::Starting {
            service: value
                .get("service")
                .and_then(|v| v.as_str())
                .unwrap_or("dashboard")
                .to_string(),
        }),
        // The supervisor's "ready" means Next is listening — not that the
        // window has opened it. Promoting that to BootState::Ready made the
        // boot page say "Ready — opening…" and stop polling while the shell
        // still owed it a bootstrap navigation (and, worse, handed it a
        // 127.0.0.1 URL with no token). The shell alone marks Ready, with the
        // URL the webview must actually load.
        "ready" => Some(BootState::Starting {
            service: "handoff".into(),
        }),
        "failed" => Some(BootState::Failed {
            error: value
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Startup failed")
                .to_string(),
            logs: Vec::new(),
            // The supervisor reports its own failures; port ownership is the
            // shell's business, so it never sets this.
            stoppable_dev_server: false,
            install_wsl: false,
        }),
        "stopping" => Some(BootState::Stopping),
        _ => None,
    }
}

#[cfg(unix)]
extern "C" {
    #[link_name = "setsid"]
    fn libc_setsid() -> i32;
    #[link_name = "killpg"]
    fn libc_killpg(pgrp: i32, sig: i32) -> i32;
}

/// A free loopback port, for the isolated self-test.
///
/// Binding to port 0 and reading back what the kernel assigned is the only way
/// to do this without a race that the self-test would hit on a busy CI runner.
pub fn free_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    listener.local_addr().map(|a| a.port())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_host_avoids_ipv6_only_on_windows() {
        let sidecar = Sidecar::new(
            1337,
            1339,
            "tok".into(),
            DesktopLog::open(&std::env::temp_dir()),
        );
        let url = sidecar.bootstrap_url();
        if cfg!(windows) {
            assert!(url.starts_with("http://127.0.0.1:1337/"), "{url}");
        } else {
            assert!(url.starts_with("http://localhost:1337/"), "{url}");
        }
        assert!(url.ends_with("/api/desktop/bootstrap?token=tok"));
    }

    #[test]
    fn free_ports_are_actually_free() {
        let port = free_port().unwrap();
        assert!(port > 0);
        assert!(
            !port_in_use(port),
            "port {port} should be free right after allocation"
        );
    }

    #[test]
    fn health_check_rejects_a_non_devhub_listener() {
        // The whole point: something answering on the port is not DevHub.
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut s in listener.incoming().take(1).flatten() {
                use std::io::Write;
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi");
            }
        });
        std::thread::sleep(Duration::from_millis(100));
        assert!(port_in_use(port), "the fake listener should be up");
        assert!(
            !health_check(port, "token"),
            "an arbitrary HTTP server must not pass as DevHub"
        );
    }

    #[test]
    fn health_check_accepts_a_keep_alive_response() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().take(1).flatten() {
                use std::io::Write;
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n1e\r\n{\"devhub\":true,\"desktop\":true}\r\n",
                );
                std::thread::sleep(Duration::from_secs(2));
            }
        });

        let started = Instant::now();
        assert!(health_check(port, "token"));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn health_check_accepts_a_fragmented_status_line() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().take(1).flatten() {
                use std::io::{BufRead, Write};
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = std::io::BufReader::new(&stream);
                let mut headers = Vec::new();
                while !headers.ends_with(b"\r\n\r\n") {
                    assert!(request.read_until(b'\n', &mut headers).unwrap() > 0);
                }
                stream.write_all(b"HTTP/1.").unwrap();
                std::thread::sleep(Duration::from_millis(20));
                let _ = stream.write_all(
                    b"1 200 OK\r\nContent-Length: 30\r\n\r\n{\"devhub\":true,\"desktop\":true}",
                );
            }
        });

        assert!(health_check(port, "token"));
    }

    /// The exact shape that caused a stale `next start` to be adopted as the
    /// app's own backend: a 200, and `devhub: true` in the body.
    #[test]
    fn health_check_rejects_a_browser_mode_dashboard() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().take(1).flatten() {
                use std::io::Write;
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 52\r\n\r\n{\"devhub\":true,\"desktop\":false,\"status\":\"browser\"}",
                );
            }
        });

        assert!(
            !health_check(port, "token"),
            "a dashboard that is not our desktop sidecar must not pass as one"
        );
    }

    #[test]
    fn health_check_rejects_a_body_without_a_status_line() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().take(1).flatten() {
                use std::io::Write;
                let _ = stream.write_all(b"{\"devhub\":true,\"desktop\":true}");
            }
        });

        assert!(!health_check(port, "token"));
    }

    #[test]
    fn boot_states_round_trip_through_the_supervisor_protocol() {
        let ready = serde_json::json!({ "devhubSidecar": true, "state": "ready", "url": "http://127.0.0.1:1337" });
        assert_eq!(
            parse_state(&ready),
            Some(BootState::Starting {
                service: "handoff".into()
            }),
            "supervisor ready is not window-ready — no token, wrong host"
        );

        let starting = serde_json::json!({ "state": "starting", "service": "terminal" });
        assert_eq!(
            parse_state(&starting),
            Some(BootState::Starting {
                service: "terminal".into()
            })
        );

        // Unknown states are ignored rather than crashing the reader thread —
        // a newer supervisor talking to an older shell must not kill the app.
        assert_eq!(
            parse_state(&serde_json::json!({ "state": "teleporting" })),
            None
        );
        assert_eq!(parse_state(&serde_json::json!({})), None);
    }
}
