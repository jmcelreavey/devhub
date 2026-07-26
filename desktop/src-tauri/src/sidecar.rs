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
use crate::paths::{sidecar_env, RuntimePaths};

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
    Starting { service: String },
    Ready { url: String },
    Failed { error: String, logs: Vec<String> },
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortConflict {
    pub port: u16,
    /// Whether the thing already listening answered our health check.
    pub is_devhub: bool,
}

pub struct Sidecar {
    child: Arc<Mutex<Option<Child>>>,
    log: DesktopLog,
    pub port: u16,
    pub terminal_port: u16,
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

/// Does the thing on this port claim to be *our* DevHub?
///
/// Requires the per-launch token, so a previous DevHub instance, another user's
/// instance, or a malicious local server all fail this check. Without it a
/// second launch would happily adopt whatever was listening.
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
    let mut body = String::new();
    use std::io::Read;
    if stream.read_to_string(&mut body).is_err() {
        return false;
    }
    body.starts_with("HTTP/1.1 200") && body.contains("\"devhub\":true")
}

impl Sidecar {
    pub fn new(port: u16, terminal_port: u16, token: String, log: DesktopLog) -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            log,
            port,
            terminal_port,
            token,
        }
    }

    /// Refuse to start into an occupied port, and say who owns it.
    ///
    /// Returning a conflict rather than resolving it is the point. The only
    /// safe automatic resolution is "use a different port", and silently moving
    /// the port breaks every bookmark and every integration callback URL. The
    /// user gets told, with the two honest choices.
    pub fn check_ports(&self) -> Option<PortConflict> {
        for port in [self.port, self.terminal_port] {
            if port_in_use(port) {
                return Some(PortConflict {
                    port,
                    is_devhub: health_check(port, &self.token),
                });
            }
        }
        None
    }

    /// Spawn the supervisor in its own process group.
    ///
    /// The group is what makes shutdown correct: Next forks workers, the PTY
    /// server spawns shells, and those shells spawn whatever the user runs. A
    /// group leader gives us one handle for that entire tree.
    pub fn start<F>(&self, paths: &RuntimePaths, mut on_event: F) -> std::io::Result<()>
    where
        F: FnMut(BootState) + Send + 'static,
    {
        let env = sidecar_env(paths, self.port, self.terminal_port, &self.token);
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

        let mut child = cmd.spawn()?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let log_out = self.log.clone();
        let log_err = self.log.clone();

        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    log_err.write_line("sidecar", &line);
                }
            });
        }

        if let Some(stdout) = stdout {
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    log_out.write_line("sidecar", &line);
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
            if health_check(self.port, &self.token) {
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

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// The one-shot bootstrap URL that exchanges the token for a cookie.
    pub fn bootstrap_url(&self) -> String {
        format!(
            "http://127.0.0.1:{}/api/desktop/bootstrap?token={}",
            self.port, self.token
        )
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
        "ready" => Some(BootState::Ready {
            url: value
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        }),
        "failed" => Some(BootState::Failed {
            error: value
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Startup failed")
                .to_string(),
            logs: Vec::new(),
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
    fn boot_states_round_trip_through_the_supervisor_protocol() {
        let ready = serde_json::json!({ "devhubSidecar": true, "state": "ready", "url": "http://127.0.0.1:1337" });
        assert_eq!(
            parse_state(&ready),
            Some(BootState::Ready {
                url: "http://127.0.0.1:1337".into()
            })
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
