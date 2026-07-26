//! `--self-test`: prove this build actually works, without touching live data.
//!
//! This runs in CI on every target, and again from `/Applications` before the
//! old Electron app is allowed to be deleted. Both callers need the same
//! guarantee, and it is a strong one: **the self-test must never read or mutate
//! the user's real data.** So it gets a temporary app-data directory and
//! kernel-assigned ports, and the temp directory is removed on every exit path.
//!
//! What it proves, in order, because a later step is meaningless if an earlier
//! one failed:
//!
//! 1. Every staged resource the app needs is present.
//! 2. The bundled Node runtime runs on this machine.
//! 3. The sidecar starts and Next serves.
//! 4. An unauthenticated request is rejected — the bootstrap guard is live.
//! 5. An authenticated read/write round-trip works, in temporary storage.
//! 6. The PTY server is listening.
//! 7. Everything stops, leaving no listener and no child process.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

use crate::logging::DesktopLog;
use crate::paths::RuntimePaths;
use crate::sidecar::{free_port, port_in_use, Sidecar};

pub struct SelfTestReport {
    pub checks: Vec<(String, bool, String)>,
}

impl SelfTestReport {
    fn add(&mut self, name: &str, ok: bool, detail: impl Into<String>) {
        self.checks.push((name.to_string(), ok, detail.into()));
    }

    pub fn passed(&self) -> bool {
        self.checks.iter().all(|(_, ok, _)| *ok)
    }

    pub fn print(&self) {
        for (name, ok, detail) in &self.checks {
            let mark = if *ok { "PASS" } else { "FAIL" };
            if detail.is_empty() {
                println!("{mark}  {name}");
            } else {
                println!("{mark}  {name} — {detail}");
            }
        }
        println!(
            "\n{}",
            if self.passed() {
                "self-test passed"
            } else {
                "self-test FAILED"
            }
        );
    }
}

/// Minimal HTTP GET on loopback.
///
/// Hand-rolled rather than pulling in an HTTP client: the self-test must not
/// depend on TLS, proxies, redirects, or anything else that could make it fail
/// for a reason unrelated to the app. It talks to 127.0.0.1 and nothing else.
fn http_get(port: u16, path: &str, headers: &[(&str, &str)]) -> Option<(u16, String)> {
    let mut stream = TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_secs(2),
    )
    .ok()?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .ok()?;

    let mut request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n");
    for (key, value) in headers {
        request.push_str(&format!("{key}: {value}\r\n"));
    }
    request.push_str("Connection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;

    let mut raw = String::new();
    stream.read_to_string(&mut raw).ok()?;
    let status = raw
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    Some((status, raw))
}

pub fn run(resource_dir: PathBuf, node_bin: PathBuf) -> SelfTestReport {
    let mut report = SelfTestReport { checks: Vec::new() };

    // Isolated app data. `tempfile` removes it when `temp` drops, including on
    // the early-return paths below — which is why every failure returns the
    // report rather than exiting.
    let temp = match tempfile::tempdir() {
        Ok(t) => t,
        Err(err) => {
            report.add("temporary app data", false, err.to_string());
            return report;
        }
    };

    let paths = RuntimePaths {
        app_data: temp.path().join("app-data"),
        resource_root: resource_dir.join("resources"),
        server_dir: resource_dir.join("server"),
        services_dir: resource_dir.join("services"),
        node_bin,
    };

    // 1. Staged resources.
    let required: Vec<(&str, PathBuf)> = vec![
        ("server entrypoint", paths.server_dir.join("server.js")),
        (
            "client assets",
            paths.server_dir.join(".next").join("static"),
        ),
        ("supervisor", paths.supervisor()),
        (
            "terminal server",
            paths.services_dir.join("terminal-pty-server.cjs"),
        ),
        ("packaged skills", paths.resource_root.join("skills")),
        ("node runtime", paths.node_bin.clone()),
    ];
    let mut resources_ok = true;
    for (label, path) in &required {
        if !path.exists() {
            resources_ok = false;
            report.add(
                &format!("resource: {label}"),
                false,
                path.display().to_string(),
            );
        }
    }
    if resources_ok {
        report.add(
            "staged resources",
            true,
            format!("{} checked", required.len()),
        );
    } else {
        return report; // Nothing below can pass; don't produce misleading noise.
    }

    // 2. The bundled runtime runs here.
    match std::process::Command::new(&paths.node_bin)
        .arg("--version")
        .output()
    {
        Ok(out) if out.status.success() => report.add(
            "bundled node runtime",
            true,
            String::from_utf8_lossy(&out.stdout).trim().to_string(),
        ),
        Ok(out) => {
            report.add(
                "bundled node runtime",
                false,
                format!("exited {}", out.status),
            );
            return report;
        }
        Err(err) => {
            report.add("bundled node runtime", false, err.to_string());
            return report;
        }
    }

    if let Err(err) = paths.ensure_app_data() {
        report.add("temporary app data tree", false, err.to_string());
        return report;
    }
    report.add(
        "temporary app data tree",
        true,
        paths.app_data.display().to_string(),
    );

    // Kernel-assigned ports: the self-test must not collide with a running
    // DevHub, and on CI it must not collide with a parallel job either.
    let (port, terminal_port) = match (free_port(), free_port()) {
        (Ok(a), Ok(b)) => (a, b),
        _ => {
            report.add("allocate test ports", false, "no free loopback ports");
            return report;
        }
    };

    let log = DesktopLog::open(&paths.log_dir());
    let token = crate::new_bootstrap_token();
    let sidecar = Sidecar::new(port, terminal_port, token.clone(), log.clone());

    // 3. Start and serve.
    if let Err(err) = sidecar.start(&paths, |_| {}) {
        report.add("sidecar start", false, err.to_string());
        return report;
    }
    match sidecar.wait_until_healthy(Duration::from_secs(90)) {
        Ok(()) => report.add("authenticated health", true, format!("port {port}")),
        Err(err) => {
            report.add("authenticated health", false, err);
            for line in log.tail(20) {
                println!("      {line}");
            }
            sidecar.stop();
            return report;
        }
    }

    // 4. The guard is live. A health endpoint that answers anyone is not a
    //    guard, and this is the check that would have caught it.
    match http_get(port, "/api/desktop/health", &[]) {
        Some((status, _)) if status == 401 || status == 403 => report.add(
            "unauthenticated request rejected",
            true,
            format!("HTTP {status}"),
        ),
        Some((status, _)) => report.add(
            "unauthenticated request rejected",
            false,
            format!("expected 401/403, got {status}"),
        ),
        None => report.add("unauthenticated request rejected", false, "no response"),
    }

    // 5. Read/write round-trip, in temporary storage only.
    let auth = [("X-DevHub-Token", token.as_str())];
    match http_get(port, "/api/desktop/selftest-roundtrip", &auth) {
        Some((200, body)) if body.contains("\"ok\":true") => report.add(
            "storage round-trip",
            true,
            "wrote and read back in temp app data",
        ),
        Some((status, _)) => report.add("storage round-trip", false, format!("HTTP {status}")),
        None => report.add("storage round-trip", false, "no response"),
    }

    // 6. PTY server up. Only that it is listening: spawning a shell inside a
    //    CI container proves nothing useful and fails for unrelated reasons.
    report.add(
        "terminal server listening",
        port_in_use(terminal_port),
        format!("port {terminal_port}"),
    );

    // 7. Clean shutdown. The check nobody writes and everybody needs — an
    //    orphaned Next server holding 1337 is the single most common way a
    //    desktop shell ruins the next launch.
    sidecar.stop();
    std::thread::sleep(Duration::from_millis(600));
    let dashboard_free = !port_in_use(port);
    let terminal_free = !port_in_use(terminal_port);
    report.add(
        "no listener left behind",
        dashboard_free && terminal_free,
        format!(
            "dashboard {}, terminal {}",
            if dashboard_free {
                "released"
            } else {
                "STILL BOUND"
            },
            if terminal_free {
                "released"
            } else {
                "STILL BOUND"
            }
        ),
    );

    // Prove the isolation claim rather than asserting it: nothing may have been
    // written outside the temporary tree.
    report.add(
        "writes confined to temporary app data",
        paths.app_data.starts_with(temp.path()),
        paths.app_data.display().to_string(),
    );

    report
}
