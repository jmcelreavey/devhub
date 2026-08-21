//! The DevHub desktop shell.
//!
//! Rust owns the window, the process tree, and the update client. It owns
//! nothing about the product: the dashboard remains a Next.js app served over
//! loopback, and no product logic was rewritten to get here.
//!
//! The security posture is worth stating once, because several decisions below
//! only make sense against it. The page in this window is a *remote origin*
//! (`http://127.0.0.1:1337`). Anything the webview can call, that origin can
//! call. "It's only localhost" is not an authentication mechanism — any process
//! on the machine, and any web page that can be tricked into fetching localhost,
//! reaches the same port. So: capabilities stay minimal, there is no generic
//! shell command, and the bridge routes require a cookie the shell sets once
//! from a token only it knows.

mod icon;
mod logging;
mod paths;
mod selftest;
mod sidecar;
mod updater;

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rand::Rng;
use serde::Serialize;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use logging::DesktopLog;
use paths::{default_app_data, RuntimePaths};
use sidecar::{BootState, Sidecar};

const DEFAULT_PORT: u16 = 1337;
const DEFAULT_TERMINAL_PORT: u16 = 1339;
/// A cold `npm run dev` in this checkout is genuinely slow: the `predev` health
/// check, plugin materialisation, the peer services, and then a webpack cold
/// compile. 90s used to expire mid-compile and present a working startup as a
/// failure, so this is deliberately generous — the `try_wait` check in
/// `wait_for_dev_server` is what makes a *dead* child fail fast.
const DEV_SERVER_START_TIMEOUT: Duration = Duration::from_secs(300);
const DEV_SERVER_STOP_TIMEOUT: Duration = Duration::from_secs(10);

/// A fresh 256-bit token per launch.
///
/// Per-launch, not persisted: a token on disk is a token that survives a
/// compromise and a token that a previous install can replay. `rand`'s thread
/// RNG is a CSPRNG, which is the property that matters — this value is the only
/// thing standing between a web page and the user's shell.
pub fn new_bootstrap_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) struct AppState {
    sidecar: Arc<Sidecar>,
    dev_server: Arc<Mutex<Option<Child>>>,
    paths: RuntimePaths,
    pub(crate) log: DesktopLog,
    boot: Mutex<BootState>,
}

#[derive(Serialize, Clone)]
struct BootPayload {
    #[serde(flatten)]
    state: BootState,
}

/// Resolve the packaged layout.
///
/// In development the staging directory is used directly, so `desktop:dev` does
/// not need a bundled app to iterate on the shell.
fn resolve_paths(app: &tauri::AppHandle) -> Result<RuntimePaths, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("No resource directory: {e}"))?;

    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("No home directory: {e}"))?;

    /*
     * The bundled Node runtime, shipped as a *resource* rather than via Tauri's
     * `externalBin`.
     *
     * `externalBin` places the binary in `Contents/MacOS/`, and macOS treats
     * everything there as an executable belonging to the app. The result was a
     * second "node" icon appearing in the Dock and bouncing whenever the
     * sidecar started — a background process the user could not click, quit, or
     * make sense of. Resources get no such treatment.
     *
     * The candidates below cover the bundle layout, the older `externalBin`
     * layout (so an app installed before this change still starts), and the
     * development staging directory.
     */
    let triple_suffixed = format!("{}-{}", node_binary_name(), std::env::consts::ARCH);
    let mut candidates = vec![
        resource_dir.join("runtime").join(node_binary_name()),
        resource_dir.join("runtime").join(&triple_suffixed),
        resource_dir.join(node_binary_name()),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(node_binary_name()));
        }
    }
    // The staged runtime keeps its Rust target-triple suffix; match by prefix
    // rather than hardcoding a triple that changes per architecture.
    if let Ok(entries) = std::fs::read_dir(resource_dir.join("runtime")) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("node-") {
                candidates.push(entry.path());
            }
        }
    }
    let node_bin = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| resource_dir.join("runtime").join(node_binary_name()));

    Ok(RuntimePaths {
        app_data: std::env::var_os("DEVHUB_APP_DATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| default_app_data(&home)),
        resource_root: resource_dir.join("resources"),
        server_dir: resource_dir.join("server"),
        services_dir: resource_dir.join("services"),
        node_bin,
    })
}

fn node_binary_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// Current boot state, for the boot page to render on first paint.
///
/// The page also listens for `devhub://boot`, but an event-only design loses
/// every state emitted before the listener attached — which on a fast machine
/// is all of them, and on a slow one is the interesting ones.
#[tauri::command]
fn boot_state(state: tauri::State<'_, AppState>) -> BootState {
    state
        .boot
        .lock()
        .map(|s| s.clone())
        .unwrap_or(BootState::Preparing)
}

/// The last lines of the desktop log, for the failure UI and the boot screen.
///
/// The boot screen polls this while starting. A startup that takes minutes with
/// nothing to look at is indistinguishable from a hung one, and "open the log
/// folder" is a poor answer when the window you are staring at could just show
/// you the log.
#[tauri::command]
fn recent_logs(state: tauri::State<'_, AppState>) -> Vec<String> {
    state.log.tail(80)
}

/// Reveal the log file in the OS file manager.
///
/// Deliberately narrow: it opens one known path. A general "open this path"
/// command would be a file-manager-launching primitive handed to a web origin.
#[tauri::command]
fn open_logs(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let dir = state.paths.log_dir();
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
        .map(|_| {
            let _ = app;
        })
}

/// Close the shell from the boot page's Quit button.
///
/// The page cannot do this itself. `window.close()` is a no-op for a window the
/// script did not open, so Quit silently did nothing on the one screen where the
/// app has not started and Quit is the only way out. Closing here runs the
/// Destroyed handler, which stops the sidecar process group — the thing that
/// keeps an orphaned Next server from holding port 1337 into the next launch.
#[tauri::command]
fn quit_app(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// Native folder picker for the setup wizard's "code folder" step.
///
/// This is the one place the webview genuinely needs a native capability:
/// asking someone to type an absolute path into a text field is the worst step
/// of the old wizard. It returns a path the *user* chose through an OS dialog —
/// the webview cannot name a directory and have it selected.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle, title: Option<String>) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Choose your code folder"))
        .pick_folder(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    rx.recv().ok().flatten()
}

/// What the dashboard needs to know about its shell.
#[tauri::command]
fn desktop_info(state: tauri::State<'_, AppState>) -> serde_json::Value {
    serde_json::json!({
        "desktop": true,
        "version": env!("CARGO_PKG_VERSION"),
        "appData": state.paths.app_data.to_string_lossy(),
        "resourceRoot": state.paths.resource_root.to_string_lossy(),
        "logPath": state.log.path().to_string_lossy(),
    })
}

/// Persist a small, structured breadcrumb from the dashboard webview.
///
/// The remote dashboard is allowed to report only known bridge phases. It
/// cannot choose a log path, and the payload is scrubbed before it reaches disk.
#[tauri::command]
fn renderer_log(
    phase: String,
    message: String,
    host: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let phase = match phase.as_str() {
        "bridge:open" | "bridge:tauri-detect" | "bridge:invoke" | "nav:external-intercept" => phase,
        _ => return Err("Unknown renderer log phase".into()),
    };
    let host = host.as_deref().map(sanitize_log_host);
    let message = sanitize_renderer_message(&message);
    let detail = host
        .filter(|host| !host.is_empty())
        .map(|host| format!("[host={host}] {message}"))
        .unwrap_or(message);
    state.log.write_line(&format!("renderer:{phase}"), &detail);
    Ok(())
}

fn sanitize_log_host(host: &str) -> String {
    host.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
        .take(255)
        .collect()
}

fn sanitize_renderer_message(message: &str) -> String {
    let mut clean = message
        .chars()
        .filter(|c| !c.is_control())
        .take(500)
        .collect::<String>();
    let lower = clean.to_ascii_lowercase();
    for marker in [
        "token=",
        "secret=",
        "password=",
        "authorization=",
        "api_key=",
    ] {
        if let Some(index) = lower.find(marker) {
            clean.truncate(index + marker.len());
            clean.push_str("[redacted]");
            break;
        }
    }
    clean
}

/// Restart the sidecar after a failure.
///
/// Stop-then-start rather than a targeted repair: the failure modes worth
/// recovering from (a port freed up, a config fixed) are all cured by a clean
/// restart, and a partial one would leave state nobody can reason about.
#[tauri::command]
async fn retry_start(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.sidecar.stop();
    std::thread::sleep(Duration::from_millis(300));
    start_sidecar(&app)
}

/// Stop a leftover DevHub dev server that is holding our ports, then start.
///
/// Offered only when startup already classified the listener as one of our
/// checkout's own dev services — but this deliberately takes no PID from the
/// caller and re-derives everything. The boot page is a page; a command that
/// accepts "please stop process 4211" is a process-killing primitive handed to a
/// renderer, and the fact that today's renderer is trustworthy is not the kind
/// of thing to build a security boundary on.
///
/// `stop_attached_dev_server` is reused rather than reimplemented because it
/// already refuses to signal anything that fails the checkout fingerprint.
#[tauri::command]
async fn stop_conflicting_dev_server(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        state.log.write_line(
            "shell:startup",
            "[startup] user asked DevHub to stop the leftover development server",
        );
    }
    stop_attached_dev_server(&app).inspect_err(|err| {
        fail(&app, err);
    })?;
    start_sidecar(&app)
}

fn set_boot(app: &tauri::AppHandle, next: BootState) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.boot.lock() {
            *guard = next.clone();
        }
    }
    let _ = app.emit("devhub://boot", BootPayload { state: next });
}

/**
 * Attach to a dashboard you are already running, instead of starting one.
 *
 * The Electron launcher could run the dashboard from your checkout in dev mode;
 * removing it took that away, and `npm run dev` in a browser tab is not the
 * same thing when you are working on something that only exists in the desktop
 * shell — the boot page, the folder picker, the update banner.
 *
 * With `DEVHUB_DEV_SERVER_URL` set, the shell skips the packaged sidecar
 * entirely and loads that URL. There is no bootstrap token in this mode, so the
 * bridge routes report browser mode and the terminal falls back to origin
 * checking — which is exactly the posture `npm run dev` already has, and is why
 * this does not weaken anything. It is a developer affordance, not a
 * configuration a shipped app ever reaches.
 *
 *   DEVHUB_DEV_SERVER_URL=http://127.0.0.1:1337 open -a DevHub
 */
fn dev_server_pref_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.try_state::<AppState>()
        .map(|s| s.paths.app_data.join("config").join("dev-server.txt"))
}

/// The dev server to attach to, from the environment or the saved preference.
///
/// Two sources because they answer different needs. The environment variable is
/// for a one-off launch from a terminal; the saved preference is for the menu
/// item, because "run the app from a shell with an env var set" is not a usable
/// answer for someone who just wants the old dev toggle back.
fn dev_server_url_for(app: Option<&tauri::AppHandle>) -> Option<String> {
    if let Ok(env) = std::env::var("DEVHUB_DEV_SERVER_URL") {
        let trimmed = env.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    let file = app.and_then(dev_server_pref_file)?;
    let saved = std::fs::read_to_string(file).ok()?;
    let trimmed = saved.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Connect to the first resolved address that actually accepts.
///
/// `localhost` resolves to `::1` ahead of `127.0.0.1` on macOS, while both the
/// packaged sidecar and `next dev` bind IPv4 only. Taking the first address and
/// giving up reports "connection refused" against a server that is running
/// perfectly well one entry later in the list — which is exactly what Rebuild
/// did from a packaged window.
fn connect_loopback(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, String> {
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|err| err.to_string())?;
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => return Ok(stream),
            Err(err) => last_error = Some(err),
        }
    }
    Err(match last_error {
        Some(err) => err.to_string(),
        None => format!("{host}:{port} did not resolve to any address"),
    })
}

fn dev_server_responds(url: &str) -> Result<(), String> {
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|err| format!("Bad dev server URL: {err}"))?;
    if parsed.scheme() != "http" {
        return Err("Dev server attach currently requires an http URL".into());
    }
    let host = parsed.host_str().ok_or("Dev server URL has no host")?;
    let port = parsed
        .port_or_known_default()
        .ok_or("Dev server URL has no port")?;
    let mut stream = connect_loopback(host, port, Duration::from_secs(2)).map_err(|_| {
        format!("No dev server is responding at {url}. Start `npm run dev` in the DevHub checkout, then Retry.")
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|err| err.to_string())?;
    write!(
        stream,
        "GET /api/desktop/health HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|err| err.to_string())?;
    // Accumulate rather than trusting one `read`, and match the marker in the
    // raw bytes rather than parsing the body as JSON.
    //
    // Both matter against `next dev`. A single read routinely returns the status
    // line with no body yet, and the body that follows is chunk-framed
    // (`2f\r\n{"devhub":true,…}\r\n0\r\n\r\n`), which is not valid JSON until the
    // framing is stripped. Parsing it therefore failed on every single poll, so
    // attach sat on the boot screen watching a perfectly healthy server answer
    // 200 four times a second. `sidecar::health_check` reads the same way.
    let mut response = Vec::with_capacity(2048);
    let mut chunk = [0_u8; 1024];
    let mut status_checked = false;
    loop {
        let read = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        response.extend_from_slice(&chunk[..read]);
        let text = String::from_utf8_lossy(&response);

        if !status_checked {
            let Some(end) = text.find("\r\n") else {
                continue; // status line still arriving
            };
            let status = &text[..end];
            if !status.starts_with("HTTP/") {
                return Err(format!("The process at {url} is not an HTTP server."));
            }
            if !status.starts_with("HTTP/1.1 200") && !status.starts_with("HTTP/1.0 200") {
                return Err(format!(
                    "The server at {url} did not pass DevHub's health check ({status}). Start `npm run dev` in this checkout, then Retry."
                ));
            }
            status_checked = true;
        }

        if text.contains("\"devhub\":true") {
            return Ok(());
        }
    }
    if status_checked {
        return Err(format!(
            "The server at {url} returned 200 but is not DevHub. Start `npm run dev` in this checkout, then Retry."
        ));
    }
    Err(format!(
        "The dev server at {url} did not return a health response. Start `npm run dev`, then Retry."
    ))
}

fn dev_server_endpoint(url: &str) -> Result<(String, u16), String> {
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|err| format!("Bad dev server URL: {err}"))?;
    if parsed.scheme() != "http" {
        return Err("Dev server attach currently requires an http URL".into());
    }
    let host = parsed
        .host_str()
        .ok_or("Dev server URL has no host")?
        .to_string();
    let port = parsed
        .port_or_known_default()
        .ok_or("Dev server URL has no port")?;
    Ok((host, port))
}

fn dev_server_repo_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let configured = std::env::var_os("DEVHUB_REPO_ROOT")
        .map(PathBuf::from)
        .or_else(|| {
            app.try_state::<AppState>()
                .map(|state| state.paths.app_data.join("repo-path.txt"))
                .and_then(|path| std::fs::read_to_string(path).ok())
                .map(|path| PathBuf::from(path.trim()))
        })
        .ok_or_else(|| {
            "Cannot find the DevHub checkout. Set DEVHUB_REPO_ROOT or restore ~/Library/Application Support/DevHub/repo-path.txt."
                .to_string()
        })?;

    if configured.join("package.json").is_file() && configured.join("dashboard").is_dir() {
        Ok(configured)
    } else {
        Err(format!(
            "DevHub checkout is missing or incomplete: {}",
            configured.display()
        ))
    }
}

fn dev_server_path() -> std::ffi::OsString {
    let mut entries = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        entries.push(home.join(".volta").join("bin"));
        entries.push(home.join(".npm-global").join("bin"));
    }
    entries.extend(
        std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .unwrap_or_default(),
    );
    std::env::join_paths(entries).unwrap_or_else(|_| "/usr/bin:/bin".into())
}

fn npm_command(path: &std::ffi::OsStr) -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("DEVHUB_NPM_PATH") {
        let configured = PathBuf::from(configured);
        if configured.is_file() {
            return Ok(configured);
        }
        return Err(format!(
            "DEVHUB_NPM_PATH does not point to an npm executable: {}",
            configured.display()
        ));
    }

    for directory in std::env::split_paths(path) {
        let npm = directory.join(if cfg!(windows) { "npm.cmd" } else { "npm" });
        if npm.is_file() {
            return Ok(npm);
        }
    }
    Err("Could not find npm. Set DEVHUB_NPM_PATH to its full path, then Retry.".to_string())
}

fn start_dev_server(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let repo_root = dev_server_repo_root(app)?;
    let path = dev_server_path();
    let npm = npm_command(&path)?;

    state.log.write_line(
        "shell:attach",
        &format!(
            "[attach] starting `{}` run dev in {}",
            npm.display(),
            repo_root.display()
        ),
    );
    let mut command = Command::new(npm);
    command
        .arg("run")
        .arg("dev")
        .current_dir(&repo_root)
        .env("PATH", &path)
        // So the dashboard's log API (and anything else that reads app data)
        // looks in the same place the shell writes, not the checkout root.
        .env("DEVHUB_APP_DATA", &state.paths.app_data)
        // Tells the dashboard that this server has an owner. Without it the
        // Status page offers a rebuild that spawns a *detached* `npm run
        // restart`, which frees port 1337 by killing whoever holds it — and it
        // outlives this shell, so it can land after a mode switch and kill the
        // server the user has since moved to. Been there.
        .env("DEVHUB_SHELL_SUPERVISED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc_setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    let mut child = command.spawn().map_err(|err| {
        format!(
            "Could not start `npm run dev` in {}: {err}",
            repo_root.display()
        )
    })?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_log = state.log.clone();
    let stderr_log = state.log.clone();

    if let Some(stdout) = stdout {
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
            {
                stdout_log.write_line("sidecar:dev:stdout", &line);
            }
        });
    }
    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
            {
                stderr_log.write_line("sidecar:dev:stderr", &line);
            }
        });
    }
    *state.dev_server.lock().unwrap() = Some(child);
    state.log.write_line(
        "shell:attach",
        &format!("[attach] waiting for health at {url}/api/desktop/health"),
    );
    Ok(())
}

fn stop_dev_server(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let mut child = match state.dev_server.lock() {
        Ok(child) => child,
        Err(poisoned) => poisoned.into_inner(),
    };
    let Some(mut child) = child.take() else {
        return;
    };
    let pid = child.id();
    state.log.write_line(
        "shell:attach",
        &format!("[attach] stopping dev server group {pid}"),
    );

    #[cfg(unix)]
    unsafe {
        libc_killpg(pid as i32, 15);
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    #[cfg(unix)]
    unsafe {
        libc_killpg(pid as i32, 9);
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn command_output(command: &str, args: &[String]) -> Result<String, String> {
    Command::new(command)
        .args(args)
        .output()
        .map_err(|err| format!("Could not run {command}: {err}"))
        .and_then(|output| {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).into_owned())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        })
}

fn listener_pids(port: u16) -> Result<Vec<u32>, String> {
    let output = command_output(
        "/usr/sbin/lsof",
        &[
            "-nP".into(),
            format!("-iTCP:{port}"),
            "-sTCP:LISTEN".into(),
            "-t".into(),
        ],
    )?;
    Ok(output
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect())
}

fn process_cwd(pid: u32) -> Option<PathBuf> {
    let output = command_output(
        "/usr/sbin/lsof",
        &[
            "-a".into(),
            "-p".into(),
            pid.to_string(),
            "-d".into(),
            "cwd".into(),
            "-Fn".into(),
        ],
    )
    .ok()?;
    output
        .lines()
        .find_map(|line| line.strip_prefix('n'))
        .map(PathBuf::from)
}

fn process_command(pid: u32) -> Option<String> {
    command_output(
        "/bin/ps",
        &[
            "-ww".into(),
            "-p".into(),
            pid.to_string(),
            "-o".into(),
            "command=".into(),
        ],
    )
    .ok()
    .map(|output| output.trim().to_string())
}

fn process_parent(pid: u32) -> Option<u32> {
    command_output(
        "/bin/ps",
        &["-p".into(), pid.to_string(), "-o".into(), "ppid=".into()],
    )
    .ok()?
    .trim()
    .parse()
    .ok()
}

/// The processes `npm run dev` starts in a DevHub checkout.
///
/// `next-server` earns its place despite being the vaguest: Next rewrites its
/// own argv, so the worker holding port 1337 reports nothing but
/// `next-server (v16.2.6)` — no path, no script name. The cwd check below is the
/// only thing tying it to a checkout, which is why that check is required
/// rather than merely corroborating.
const DEV_SERVICE_MARKERS: [&str; 6] = [
    "next-server",
    "next dev",
    "scripts/run-next-with-env.ts",
    "scripts/lan-port-proxy.ts",
    "scripts/terminal-pty-server.ts",
    "scripts/start-peer-services.ts",
];

/// Is this process one of the services `npm run dev` starts in our checkout?
///
/// A port number is not ownership. The process must be running *from* the
/// configured checkout's dashboard directory *and* match one of the scripts we
/// launch. Either half alone is too weak: cwd alone would match a shell someone
/// happened to leave in that directory, and the command alone would match a
/// different worktree's dev server — which attach has been careful not to adopt
/// since the day it shipped.
///
/// Pure over what the OS reports, so the classification is testable without
/// spawning a process tree.
fn is_checkout_dev_process(command: &str, cwd: Option<&Path>, dashboard: &Path) -> bool {
    if cwd != Some(dashboard) {
        return false;
    }
    DEV_SERVICE_MARKERS
        .iter()
        .any(|marker| command.contains(marker))
}

/// The packaged app's executable, as it appears in a process listing.
///
/// Matched against a listener's *ancestors* rather than the listener itself,
/// because the listener's own argv gives nothing away: a packaged DevHub holds
/// the port through `node …/server.js`, and Next rewrites the worker's argv to
/// a bare `next-server (vX)`. The app bundle only ever shows up further up.
const DESKTOP_APP_MARKER: &str = "DevHub.app/Contents/MacOS/";

/// Command lines of a process and its ancestors, nearest first.
///
/// Bounded rather than looped to init: a ppid chain that cycles is a kernel
/// bug, and hanging startup is a worse way to report one than giving up.
fn ancestor_commands(pid: u32) -> Vec<String> {
    const MAX_HOPS: usize = 8;
    let mut commands = Vec::new();
    let mut current = pid;
    for _ in 0..MAX_HOPS {
        if let Some(command) = process_command(current) {
            commands.push(command);
        }
        match process_parent(current) {
            Some(parent) if parent > 1 && parent != current => current = parent,
            _ => break,
        }
    }
    commands
}

/// Is this listener part of a running DevHub app rather than a checkout?
///
/// Pure over the ancestor command lines, so the classification is testable
/// without an app bundle to spawn.
fn is_desktop_app_chain(commands: &[String]) -> bool {
    commands
        .iter()
        .any(|command| command.contains(DESKTOP_APP_MARKER))
}

/// Who is holding a port, in the terms an error message needs.
struct PortHolder {
    pid: u32,
    command: String,
    /// A DevHub dev service from the configured checkout — ours to offer to
    /// stop, rather than a stranger's process to refuse to touch.
    ours: bool,
    /// A sidecar belonging to another running DevHub app. Also not ours to
    /// stop, but for the opposite reason: that one has a window to quit from,
    /// so the honest instruction is to go and quit it.
    desktop_app: bool,
}

/// Which holder a message should be written about, best first.
fn holder_rank(holder: &PortHolder) -> u8 {
    if holder.ours {
        2
    } else if holder.desktop_app {
        1
    } else {
        0
    }
}

/// Every listener on `port`, classified.
fn describe_port_holders(port: u16, repo_root: Option<&Path>) -> Vec<PortHolder> {
    let dashboard = repo_root.and_then(|root| root.join("dashboard").canonicalize().ok());
    listener_pids(port)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|pid| {
            let command = process_command(pid)?.trim().to_string();
            let cwd = process_cwd(pid).and_then(|cwd| cwd.canonicalize().ok());
            let ours = dashboard.as_deref().is_some_and(|dashboard| {
                is_checkout_dev_process(&command, cwd.as_deref(), dashboard)
            });
            // Only worth the walk when the cheaper check said no: our own
            // checkout's server is never also somebody's packaged app.
            let desktop_app = !ours && is_desktop_app_chain(&ancestor_commands(pid));
            Some(PortHolder {
                pid,
                command,
                ours,
                desktop_app,
            })
        })
        .collect()
}

/// The listener worth naming, preferring one we recognise as ours.
///
/// `npm run dev` puts two listeners on 1337 — the LAN proxy and the Next worker
/// — and `lsof` order is not meaningful. Reporting whichever came back first
/// told the user their own dev server was "another program's process".
fn describe_port_holder(port: u16, repo_root: Option<&Path>) -> Option<PortHolder> {
    describe_port_holders(port, repo_root)
        .into_iter()
        .reduce(|best, next| {
            if holder_rank(&next) > holder_rank(&best) {
                next
            } else {
                best
            }
        })
}

/// Say what is on the port, and what can be done about it.
///
/// Named separately from the check because the message is the whole feature.
/// "Port 1337 is in use by another program" was technically true and actively
/// misleading: the program was `scripts/lan-port-proxy.ts` from this very
/// checkout — DevHub's own dev helper, left behind by a `npm run dev` nobody
/// remembered starting. Telling someone to go hunt down our mess by hand is not
/// an error message, it is a shrug.
fn port_conflict_message(port: u16, holder: Option<&PortHolder>) -> String {
    // lsof is absent or told us nothing. Still better than silence.
    let Some(holder) = holder else {
        return format!(
            "Port {port} is in use and DevHub could not identify the process holding it. Run `lsof -nP -iTCP:{port} -sTCP:LISTEN` to find it, quit it, then Retry."
        );
    };
    if holder.ours {
        return format!(
            "Port {port} is held by a leftover DevHub development server (PID {}) from your checkout. \
             DevHub can stop it and carry on, or you can attach to it instead from View → Attach to Dev Server…",
            holder.pid
        );
    }
    // Said only when a DevHub app really is running. It used to be said
    // whenever the port answered, which pointed the user at a window that had
    // closed an hour earlier.
    if holder.desktop_app {
        return format!(
            "Another DevHub is already using port {port}. Quit it, or use the window that is already open."
        );
    }
    format!(
        "Port {port} is in use by PID {} ({}). DevHub will not stop another program's process — quit it, then Retry.",
        holder.pid,
        truncate_command(&holder.command)
    )
}

/// Enough of a command line to recognise it, not enough to fill the dialog.
fn truncate_command(command: &str) -> String {
    const LIMIT: usize = 120;
    if command.chars().count() <= LIMIT {
        return command.to_string();
    }
    let kept: String = command.chars().take(LIMIT).collect();
    format!("{kept}…")
}

fn is_checkout_dev_listener(pid: u32, repo_root: &std::path::Path) -> bool {
    let Some(dashboard) = repo_root.join("dashboard").canonicalize().ok() else {
        return false;
    };
    let Some(command) = process_command(pid) else {
        return false;
    };
    let cwd = process_cwd(pid).and_then(|cwd| cwd.canonicalize().ok());
    is_checkout_dev_process(&command, cwd.as_deref(), &dashboard)
}

/// A healthy DevHub is still not necessarily *this checkout*. Attach must not
/// quietly reuse an old worktree merely because it also happens to use 1337.
fn verify_checkout_dev_server(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let (host, port) = dev_server_endpoint(url)?;
    if !matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]") {
        return Ok(());
    }

    let repo_root = dev_server_repo_root(app)?;
    let listener_is_checkout = listener_pids(port)?
        .into_iter()
        .any(|pid| is_checkout_dev_listener(pid, &repo_root));
    if listener_is_checkout {
        return Ok(());
    }

    Err(format!(
        "Port {port} is serving DevHub, but not from this checkout ({}). Stop that server or update the recorded checkout before attaching.",
        repo_root.display()
    ))
}

fn dev_command_ancestor(pid: u32) -> Option<u32> {
    let mut current = pid;
    for _ in 0..16 {
        let command = process_command(current)?;
        if command.contains("npm") && command.contains("run dev") {
            return Some(current);
        }
        let parent = process_parent(current)?;
        if parent <= 1 || parent == current {
            return None;
        }
        current = parent;
    }
    None
}

fn signal_process(pid: u32, signal: i32) {
    #[cfg(unix)]
    unsafe {
        libc_kill(pid as i32, signal);
    }
    #[cfg(not(unix))]
    {
        let _ = (pid, signal);
    }
}

fn wait_for_ports_to_clear(ports: &[u16], timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if ports.iter().all(|port| !sidecar::port_in_use(*port)) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    ports.iter().all(|port| !sidecar::port_in_use(*port))
}

/// Stop the checkout server before returning to the packaged server.
///
/// The app-owned child has a private process group and is stopped through its
/// handle. A developer-started server has no such handle, so we inspect its
/// listeners first and signal only verified DevHub processes. We never signal a
/// process group here: when npm was launched from a terminal, that group also
/// contains the user's shell.
fn stop_attached_dev_server(app: &tauri::AppHandle) -> Result<(), String> {
    set_boot(
        app,
        BootState::Starting {
            service: "stopping-dev-server".into(),
        },
    );
    let state = app.state::<AppState>();
    state
        .log
        .write_line("shell:switch", "[switch] phase=stopping-development-server");
    stop_dev_server(app);

    let ports = [DEFAULT_PORT, DEFAULT_TERMINAL_PORT];
    if wait_for_ports_to_clear(&ports, Duration::from_secs(2)) {
        return Ok(());
    }

    let repo_root = dev_server_repo_root(app)?;
    let mut listeners = Vec::new();
    for port in ports {
        if !sidecar::port_in_use(port) {
            continue;
        }
        for pid in listener_pids(port)? {
            if !is_checkout_dev_listener(pid, &repo_root) {
                return Err(format!(
                    "Port {port} is held by process {pid}, which is not a verified DevHub checkout server. DevHub left it alone."
                ));
            }
            listeners.push(pid);
        }
    }
    listeners.sort_unstable();
    listeners.dedup();
    if listeners.is_empty() {
        return Err(
            "DevHub's ports are still occupied, but no listener could be identified.".into(),
        );
    }

    let mut dev_commands = listeners
        .iter()
        .filter_map(|pid| dev_command_ancestor(*pid))
        .collect::<Vec<_>>();
    dev_commands.sort_unstable();
    dev_commands.dedup();
    for pid in dev_commands {
        state.log.write_line(
            "shell:switch",
            &format!("[switch] stopping verified `npm run dev` process {pid}"),
        );
        signal_process(pid, 15);
    }
    if wait_for_ports_to_clear(&ports, Duration::from_secs(5)) {
        return Ok(());
    }

    // npm does not always forward SIGTERM across every concurrently child.
    // These PIDs have already passed the repo+cowd+command fingerprint above,
    // so this remains narrower than killing "whatever owns 1337".
    for pid in &listeners {
        state.log.write_line(
            "shell:switch",
            &format!("[switch] stopping verified checkout listener {pid}"),
        );
        signal_process(*pid, 15);
    }
    if wait_for_ports_to_clear(&ports, Duration::from_secs(3)) {
        return Ok(());
    }

    for pid in listeners {
        state.log.write_line(
            "shell:switch",
            &format!("[switch] verified listener {pid} ignored SIGTERM; sending SIGKILL"),
        );
        signal_process(pid, 9);
    }
    if wait_for_ports_to_clear(&ports, Duration::from_secs(2)) {
        return Ok(());
    }

    Err(format!(
        "DevHub's development server did not release ports 1337/1339 within {}s. Check the logs, then Retry.",
        DEV_SERVER_STOP_TIMEOUT.as_secs()
    ))
}

/// The `service` string the boot page renders, with elapsed seconds attached.
///
/// The boot page splits on `:` and looks the base up in its label table, so a
/// long compile reads as progress rather than as an unchanging "Starting
/// development server…" that is indistinguishable from a hang.
fn starting_service_label(service: &str, elapsed: Duration) -> String {
    format!("{service}:{}", elapsed.as_secs())
}

fn wait_for_dev_server(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let started = Instant::now();
    let deadline = started + DEV_SERVER_START_TIMEOUT;
    let mut last_reported = 0;
    while Instant::now() < deadline {
        let elapsed = started.elapsed();
        if elapsed.as_secs() / 5 > last_reported {
            last_reported = elapsed.as_secs() / 5;
            set_boot(
                app,
                BootState::Starting {
                    service: starting_service_label("dev-server", elapsed),
                },
            );
        }
        if dev_server_responds(url).is_ok() {
            if let Some(state) = app.try_state::<AppState>() {
                state
                    .log
                    .write_line("shell:attach", "[attach] dev server is healthy");
            }
            return Ok(());
        }
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(mut child) = state.dev_server.lock() {
                if let Some(child) = child.as_mut() {
                    if let Ok(Some(status)) = child.try_wait() {
                        return Err(format!("`npm run dev` exited during startup ({status})."));
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    Err(format!(
        "`npm run dev` did not become healthy within {}s. Check the log tail below.",
        DEV_SERVER_START_TIMEOUT.as_secs()
    ))
}

/// Navigate through a fresh network-first page before opening Attach mode.
///
/// This clears the packaged service worker, which shares localhost:1337 with
/// development and would otherwise cache stable webpack asset URLs forever.
fn attach_dev_bootstrap_url(url: &str) -> Result<tauri::Url, String> {
    let mut parsed = url
        .parse::<tauri::Url>()
        .map_err(|err| format!("Bad dev server URL: {err}"))?;
    parsed.set_path("/attach-dev.html");
    parsed.set_query(None);
    Ok(parsed)
}

fn navigate_to_dev_server(app: &tauri::AppHandle, url: String) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match attach_dev_bootstrap_url(&url) {
        Ok(attach_url) => {
            let handoff = attach_url.to_string();
            if let Err(err) = window.navigate(attach_url) {
                fail(
                    app,
                    &format!("Could not open the development server: {err}"),
                );
            } else {
                if let Some(state) = app.try_state::<AppState>() {
                    state
                        .log
                        .write_line("shell:attach", "[attach] navigation started");
                }
                // Ready.url is the URL the boot page itself will load if the
                // shell navigate is ignored — so it must be attach-dev, not
                // the bare origin (that would skip the SW clear).
                set_boot(app, BootState::Ready { url: handoff });
                show_main_window(app);
            }
        }
        Err(err) => fail(app, &err),
    }
}

fn attach_dev_server(app: &tauri::AppHandle, url: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.log.write_line(
        "shell:attach",
        &format!("[attach] checking {url}/api/desktop/health"),
    );
    set_boot(
        app,
        BootState::Starting {
            service: "dev-server".into(),
        },
    );
    match dev_server_responds(&url) {
        Ok(()) => {
            verify_checkout_dev_server(app, &url)?;
            navigate_to_dev_server(app, url);
            Ok(())
        }
        Err(health_error) => {
            let (host, port) = dev_server_endpoint(&url)?;
            if !matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]") {
                return Err(health_error);
            }
            if sidecar::port_in_use(port) {
                return Err(format!(
                    "Port {port} is already in use, but it did not pass DevHub's health check. DevHub will not start a second server over it; stop or fix that process, then Retry."
                ));
            }
            start_dev_server(app, &url)?;
            let handle = app.clone();
            std::thread::spawn(move || match wait_for_dev_server(&handle, &url) {
                Ok(()) => navigate_to_dev_server(&handle, url),
                Err(err) => fail(&handle, &err),
            });
            Ok(())
        }
    }
}

fn dev_server_url() -> Option<String> {
    std::env::var("DEVHUB_DEV_SERVER_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn start_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let sidecar = state.sidecar.clone();
    let paths = state.paths.clone();

    set_boot(
        app,
        BootState::Starting {
            service: "packaged-server".into(),
        },
    );

    if let Some(url) = dev_server_url_for(Some(app)) {
        if let Err(err) = attach_dev_server(app, url) {
            fail(app, &err);
            return Err(err);
        }
        return Ok(());
    }

    if let Err(err) = paths.ensure_app_data() {
        let message = format!("Could not create the DevHub data folder: {err}");
        fail(app, &message);
        return Err(message);
    }

    // Refuse to start into an occupied port and say what is there. Never kill
    // it: on a developer's machine port 1337 belongs to somebody's own server
    // at least as often as it belongs to us.
    if let Some(port) = sidecar.check_ports() {
        let repo_root = dev_server_repo_root(app).ok();
        let holder = describe_port_holder(port, repo_root.as_deref());
        // On disk before the dialog: this is the line that explains a failed
        // start after the fact, and the full command line is too long to show.
        if let Some(holder) = holder.as_ref() {
            state.log.write_line(
                "shell:startup",
                &format!(
                    "[startup] port {} held by pid={} ours={} app={} command={}",
                    port, holder.pid, holder.ours, holder.desktop_app, holder.command
                ),
            );
        }
        let stoppable = holder.as_ref().is_some_and(|h| h.ours);
        let message = port_conflict_message(port, holder.as_ref());
        fail_with_recovery(app, &message, stoppable);
        return Err(message);
    }

    let handle = app.clone();
    if let Err(err) = sidecar.start(&paths, move |event| {
        set_boot(&handle, event);
    }) {
        let message = format!("Could not start the DevHub server: {err}");
        fail(app, &message);
        return Err(message);
    }

    let handle = app.clone();
    let sidecar = sidecar.clone();
    std::thread::spawn(
        move || match sidecar.wait_until_healthy(Duration::from_secs(90)) {
            Ok(()) => {
                // Bootstrap URL, not the bare origin: the boot page also
                // navigates itself on Ready, and without the token it would
                // land on / with no session cookie.
                let handoff = sidecar.bootstrap_url();
                set_boot(
                    &handle,
                    BootState::Ready {
                        url: handoff.clone(),
                    },
                );
                load_dashboard(&handle, &sidecar);
                // Only once the app is healthy and on screen. Checking during
                // startup competes with the thing the user is waiting for.
                updater::check_in_background(&handle);
            }
            Err(err) => fail(&handle, &err),
        },
    );

    Ok(())
}

fn fail(app: &tauri::AppHandle, message: &str) {
    fail_with_recovery(app, message, false);
}

/// Fail, and say whether the boot screen may offer to stop a leftover of ours.
fn fail_with_recovery(app: &tauri::AppHandle, message: &str, stoppable_dev_server: bool) {
    let logs = app
        .try_state::<AppState>()
        .map(|s| s.log.tail(20))
        .unwrap_or_default();
    if let Some(state) = app.try_state::<AppState>() {
        state.log.write_line("shell:failure", message);
    }
    set_boot(
        app,
        BootState::Failed {
            error: message.to_string(),
            logs,
            stoppable_dev_server,
        },
    );
    show_main_window(app);
}

/// Swap the boot page for the dashboard.
///
/// Via the bootstrap URL, which is a one-shot: the route checks the token in
/// constant time, sets an HttpOnly cookie, and redirects to `/` without it. The
/// token therefore never survives in the address bar, in history, or in a
/// `Referer` header sent to anything the user later clicks.
///
/// The boot page also `location.replace`s the same URL when it sees Ready —
/// belt and braces, because a healthy sidecar with a stuck boot screen is how
/// this shipped. Errors are logged and, if the webview is still on the boot
/// origin a few seconds later, surfaced as a failure instead of "opening…".
fn load_dashboard(app: &tauri::AppHandle, sidecar: &Sidecar) {
    let Some(window) = app.get_webview_window("main") else {
        if let Some(state) = app.try_state::<AppState>() {
            state.log.write_line(
                "shell:handoff",
                "[handoff] no main window — cannot open the dashboard",
            );
        }
        fail(app, "DevHub's window was not ready to open the dashboard.");
        return;
    };
    let url = sidecar.bootstrap_url();
    let parsed = match url.parse::<tauri::Url>() {
        Ok(parsed) => parsed,
        Err(err) => {
            fail(app, &format!("Could not open the dashboard URL: {err}"));
            return;
        }
    };

    if let Some(state) = app.try_state::<AppState>() {
        state
            .log
            .write_line("shell:handoff", "[handoff] navigation started");
    }

    if let Err(err) = window.navigate(parsed) {
        fail(app, &format!("Could not open the dashboard: {err}"));
        return;
    }
    show_main_window(app);

    // Confirm the webview actually left the boot page. navigate() is async on
    // WKWebView; returning Ok here only means the request was queued. If it
    // never commits, the user used to sit on "Ready — opening…" forever.
    let watch = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        let Some(window) = watch.get_webview_window("main") else {
            return;
        };
        let Ok(current) = window.url() else {
            return;
        };
        if matches!(current.scheme(), "http" | "https") {
            if let Some(state) = watch.try_state::<AppState>() {
                state.log.write_line(
                    "shell:handoff",
                    &format!(
                        "[handoff] webview is on {}",
                        current.origin().ascii_serialization()
                    ),
                );
            }
            return;
        }
        if let Some(state) = watch.try_state::<AppState>() {
            state.log.write_line(
                "shell:handoff",
                &format!(
                    "[handoff] still on {} after navigate — retrying once",
                    current.scheme()
                ),
            );
        }
        if let Some(sidecar) = watch.try_state::<AppState>().map(|s| s.sidecar.clone()) {
            let retry = sidecar.bootstrap_url();
            if let Ok(parsed) = retry.parse::<tauri::Url>() {
                let _ = window.navigate(parsed);
            }
        }
        std::thread::sleep(Duration::from_secs(4));
        let Ok(current) = window.url() else {
            return;
        };
        if matches!(current.scheme(), "http" | "https") {
            return;
        }
        fail(
            &watch,
            "DevHub's server is ready, but the window could not leave the startup screen. Try again, or use View → Attach to Dev Server…",
        );
    });
}

/// Show the window only once there is something worth looking at.
///
/// A window that appears instantly and stays blank reads as a hang. One that
/// appears with the boot state already rendered reads as starting up.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn menu_log(app: &tauri::AppHandle, message: &str) {
    if let Some(state) = app.try_state::<AppState>() {
        state.log.write_line("shell:menu", message);
    }
}

/// Origin the main window is actually pointed at, if it is a dashboard.
fn current_dashboard_origin(app: &tauri::AppHandle) -> Option<String> {
    let window = app.get_webview_window("main")?;
    let url = window.url().ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

/// Stage a standalone dashboard from the checkout and install it into the
/// packaged (or `desktop:dev` staging) server *and* services trees the shell
/// actually runs.
///
/// `npm run build` alone only refreshes `dashboard/.next` in the checkout.
/// Packaged mode keeps serving `Resources/server` from the last install, and
/// keeps spawning OpenChamber/OpenCode from `Resources/services`, so Rebuild
/// looked successful while the UI *and* the peer starter stayed on the
/// previous bundle.
fn run_dashboard_build(app: &tauri::AppHandle, repo_root: &Path) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    let script = repo_root.join("desktop/scripts/rebuild-installed-server.mjs");
    if !script.is_file() {
        return Err(format!(
            "Missing rebuild script at {}. Update the checkout and try again.",
            script.display()
        ));
    }

    let path = dev_server_path();
    menu_log(
        app,
        &format!(
            "[menu] rebuild staging dashboard from {} into {} (peers: {})",
            repo_root.display(),
            paths.server_dir.display(),
            paths.services_dir.display()
        ),
    );

    let mut command = Command::new("node");
    command
        .arg(&script)
        .current_dir(repo_root)
        .env("PATH", &path)
        .env("DEVHUB_SERVER_DIR", &paths.server_dir)
        .env("DEVHUB_SERVICES_DIR", &paths.services_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc_setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("Could not start dashboard rebuild: {err}"))?;

    // Stream the build into the log so the boot screen's log panel shows it.
    if let Some(state) = app.try_state::<AppState>() {
        fn pump(
            reader: impl std::io::Read + Send + 'static,
            log: DesktopLog,
            channel: &'static str,
        ) {
            std::thread::spawn(move || {
                use std::io::BufRead;
                for line in std::io::BufReader::new(reader)
                    .lines()
                    .map_while(Result::ok)
                {
                    log.write_line(channel, &line);
                }
            });
        }
        if let Some(stdout) = child.stdout.take() {
            pump(stdout, state.log.clone(), "sidecar:build:stdout");
        }
        if let Some(stderr) = child.stderr.take() {
            pump(stderr, state.log.clone(), "sidecar:build:stderr");
        }
    }

    let status = child
        .wait()
        .map_err(|err| format!("Could not wait for dashboard rebuild: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Dashboard rebuild failed ({status}). View → Show Logs has the compiler output."
        ))
    }
}

/// Rebuild the packaged server from the checkout, then relaunch onto it.
///
/// Relaunching rather than hand-restarting a server: the normal startup path
/// already knows how to bring up whichever mode is selected, and reusing it
/// means a rebuild cannot invent a third way for the shell to reach a running
/// dashboard. The build step copies into Resources/server *and*
/// Resources/services so packaged mode actually picks up the new UI and the
/// current OpenChamber/OpenCode starter.
fn rebuild_dashboard(app: &tauri::AppHandle) {
    let repo_root = match dev_server_repo_root(app) {
        Ok(root) => root,
        Err(err) => {
            menu_log(app, &format!("[menu] rebuild-dashboard unavailable: {err}"));
            app.dialog()
                .message(format!(
                    "{err}\n\nRebuilding needs a checkout. A packaged install on its own has nothing to build from — use DevHub → Check for Updates instead."
                ))
                .title("Cannot rebuild DevHub")
                .kind(MessageDialogKind::Warning)
                .show(|_| {});
            return;
        }
    };

    menu_log(
        app,
        &format!(
            "[menu] rebuild-dashboard requested for {}",
            repo_root.display()
        ),
    );

    let handle = app.clone();
    app.dialog()
        .message(
            "DevHub will stop its server, rebuild the dashboard from your checkout into this app, and relaunch.\n\nThis takes a couple of minutes. The startup screen has a log panel if you want to watch it.",
        )
        .title("Rebuild DevHub?")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Rebuild".into(),
            "Cancel".into(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                menu_log(&handle, "[menu] rebuild-dashboard cancelled");
                return;
            }
            let app = handle.clone();
            std::thread::spawn(move || {
                // Back to the boot screen first: the server is about to go away
                // and a dashboard rendered against a dead server is a worse
                // progress indicator than no dashboard at all.
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.navigate(
                        "tauri://localhost/index.html"
                            .parse()
                            .expect("static boot URL"),
                    );
                }
                set_boot(
                    &app,
                    BootState::Starting {
                        service: "rebuild".into(),
                    },
                );

                stop_dev_server(&app);
                if let Some(state) = app.try_state::<AppState>() {
                    state.sidecar.stop();
                }

                match run_dashboard_build(&app, &repo_root) {
                    Ok(()) => {
                        menu_log(&app, "[menu] rebuild-dashboard built; relaunching");
                        app.restart();
                    }
                    Err(err) => {
                        menu_log(&app, &format!("[menu] rebuild-dashboard failed: {err}"));
                        fail(&app, &err);
                    }
                }
            });
        });
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(
        app,
        Some("About DevHub"),
        Some(AboutMetadata {
            name: Some("DevHub".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            ..Default::default()
        }),
    )?;
    let check_updates = MenuItem::with_id(
        app,
        "check-updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let show_logs = MenuItem::with_id(app, "show-logs", "Show Logs", true, None::<&str>)?;
    let open_logs_folder = MenuItem::with_id(
        app,
        "open-logs-folder",
        "Open Logs Folder",
        true,
        None::<&str>,
    )?;
    // The replacement for the Electron launcher's dev toggle. Attaching points
    // the window at a dev server you are already running instead of the
    // packaged one; the choice persists so a relaunch keeps it.
    let attached = dev_server_url_for(Some(app)).is_some();
    let dev_server = MenuItem::with_id(
        app,
        "toggle-dev-server",
        if attached {
            "Use Packaged Server"
        } else {
            "Attach to Dev Server…"
        },
        true,
        None::<&str>,
    )?;
    let reload = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
    // No accelerator on purpose. This one costs minutes and takes the server
    // down with it; it should not sit one fat-fingered keystroke from ⌘R.
    let rebuild = MenuItem::with_id(
        app,
        "rebuild-dashboard",
        "Rebuild Dashboard…",
        true,
        None::<&str>,
    )?;

    let app_menu = Submenu::with_items(
        app,
        "DevHub",
        true,
        &[
            &about,
            &check_updates,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // Edit exists purely so the OS gives the webview working copy/paste and
    // undo. Removing it does not simplify the menu, it breaks ⌘C.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    // Service restart controls deliberately live in the dashboard's own
    // Status page, not here. A desktop-only menu that grows a parallel set of
    // product actions is how two divergent UIs happen.
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &reload,
            &rebuild,
            &show_logs,
            &open_logs_folder,
            &dev_server,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}

/// Is this a loopback host, checked exactly?
///
/// Not "starts with localhost": `http://127.0.0.1.evil.com` starts with
/// `http://127.0.0.1` and is an ordinary internet domain.
fn is_loopback_host(url: &tauri::Url) -> bool {
    matches!(
        url.host_str(),
        Some("127.0.0.1") | Some("localhost") | Some("[::1]") | Some("::1")
    )
}

/// May this URL load inside the app window?
///
/// The guard's job is to stop the *window* being navigated somewhere hostile —
/// an OAuth callback, a doc link, a phishing page. It was never meant to stop
/// the dashboard embedding its own services, and originally it did exactly
/// that: `on_navigation` fires for subframes as well as top-level navigation,
/// so allowing only port 1337 blocked the OpenChamber and OpenCode iframes and
/// the browser view. All three rendered as blank white panes.
///
/// Every loopback port here belongs to DevHub — the dashboard, OpenChamber,
/// OpenCode, the PTY. Widening to loopback rather than enumerating ports keeps
/// this correct if a service moves, and gives up nothing that matters: a remote
/// page cannot make the webview navigate to loopback, and anything not on
/// loopback still goes to the system browser.
fn may_load_in_window(url: &tauri::Url, dashboard_port: u16) -> bool {
    let _ = dashboard_port; // kept for call-site clarity; loopback is the rule
    match url.scheme() {
        "http" | "https" => is_loopback_host(url),
        // Tauri's own schemes, plus the boot page and in-page documents.
        "tauri" | "asset" | "ipc" | "about" | "blob" | "data" => true,
        _ => false,
    }
}

pub fn run() {
    // `--self-test` short-circuits before any window exists: it must be usable
    // headless, from CI and from a post-install script.
    if std::env::args().any(|a| a == "--self-test") {
        let resource_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.join("../Resources")))
            .filter(|p| p.exists())
            .or_else(|| std::env::var_os("DEVHUB_SELFTEST_RESOURCES").map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("."));
        let node_bin = std::env::var_os("DEVHUB_SELFTEST_NODE")
            .map(PathBuf::from)
            .filter(|p| p.exists())
            .or_else(|| {
                // The runtime lives in Resources/runtime, not MacOS — see
                // resolve_paths() for why it moved.
                let runtime = resource_dir.join("runtime");
                std::fs::read_dir(&runtime).ok().and_then(|entries| {
                    entries.flatten().map(|e| e.path()).find(|p| {
                        p.file_name()
                            .map(|n| n.to_string_lossy().starts_with("node"))
                            .unwrap_or(false)
                    })
                })
            })
            .unwrap_or_else(|| PathBuf::from("node"));
        let report = selftest::run(resource_dir, node_bin);
        report.print();
        std::process::exit(if report.passed() { 0 } else { 1 });
    }

    tauri::Builder::default()
        // Single-instance must be registered first, before anything expensive
        // happens: the whole point is for a second launch to hand off and exit
        // rather than race the first one for the port.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            boot_state,
            recent_logs,
            open_logs,
            pick_folder,
            desktop_info,
            renderer_log,
            retry_start,
            stop_conflicting_dev_server,
            quit_app,
            icon::set_desktop_icon,
            updater::current_version,
            updater::check_update,
            updater::install_update,
            updater::relaunch
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            /*
             * Canary rehearsal: check, download, verify and install an update
             * headlessly, then exit. No window, no sidecar — the updater is
             * the only thing under test, and starting the dashboard would just
             * add ways for the run to fail for unrelated reasons.
             *
             * Same code path as the banner's Download button, so a pass here
             * means the real thing works.
             */
            if std::env::args().any(|a| a == "--canary-update") {
                let canary = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let code = updater::run_canary(canary.clone()).await;
                    canary.exit(code);
                });
                return Ok(());
            }

            let paths =
                resolve_paths(&handle).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            let _ = paths.ensure_app_data();

            let log = DesktopLog::open(&paths.log_dir());
            log.attach_emitter(handle.clone());
            log.write_line(
                "shell:startup",
                &format!("[startup] DevHub {} starting", env!("CARGO_PKG_VERSION")),
            );

            let port = std::env::var("DEVHUB_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_PORT);
            let terminal_port = std::env::var("DEVHUB_TERMINAL_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_TERMINAL_PORT);

            let sidecar = Arc::new(Sidecar::new(
                port,
                terminal_port,
                new_bootstrap_token(),
                log.clone(),
            ));

            app.manage(AppState {
                sidecar,
                dev_server: Arc::new(Mutex::new(None)),
                paths,
                log,
                boot: Mutex::new(BootState::Preparing),
            });

            if let Ok(menu) = build_menu(&handle) {
                let _ = app.set_menu(menu);
            }

            // The window is created here, not declaratively in
            // tauri.conf.json (`app.windows` is deliberately empty). Two
            // reasons: the navigation guard below must be attached to the
            // builder, because a window that exists for even one frame before
            // it is a window with a race in it — and declaring it in both
            // places panics outright with "a webview with label `main` already
            // exists", which is how this was found.
            //
            // Keep the window on the dashboard.
            //
            // Anything else opens in the system browser. Two reasons, and the
            // second is the important one: an OAuth callback or a doc link
            // replacing the app with a web page is a dead end with no back
            // button, and a window that can be navigated anywhere is a window
            // where a phishing page inherits whatever the shell exposes.
            //
            // This has to be set on the *builder*: a window that can be
            // navigated for even one frame before the guard attaches is a
            // window with a race in it.
            // In attach mode the dashboard is on whatever port the dev server
            // uses, so the guard has to allow that instead of the packaged one.
            let nav_port = dev_server_url()
                .and_then(|u| u.parse::<tauri::Url>().ok())
                .and_then(|u| u.port())
                .unwrap_or(port);
            let _window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("DevHub")
                    .inner_size(1280.0, 820.0)
                    .min_inner_size(900.0, 640.0)
                    .visible(false)
                    .center()
                    // Matches the boot page's --bg. Without it the window
                    // flashes white before first paint, which on a dark theme
                    // reads as a glitch rather than a launch.
                    .background_color(tauri::window::Color(0x0d, 0x11, 0x17, 0xff))
                    .on_navigation(move |url| {
                        if may_load_in_window(url, nav_port) {
                            return true;
                        }
                        // Anything else is off-machine: hand it to the system
                        // browser rather than replacing the app with a page the
                        // user cannot navigate back from.
                        if matches!(url.scheme(), "http" | "https") {
                            let _ = tauri_plugin_opener::open_url(url, None::<&str>);
                        }
                        false
                    })
                    .build()?;

            let boot_handle = handle.clone();
            std::thread::spawn(move || {
                // A beat before showing: if startup is fast, the boot screen
                // never flashes; if it is slow, the user sees progress rather
                // than nothing.
                std::thread::sleep(Duration::from_millis(400));
                if !matches!(
                    boot_handle.try_state::<AppState>().and_then(|s| s
                        .boot
                        .lock()
                        .ok()
                        .map(|b| b.clone())),
                    Some(BootState::Ready { .. })
                ) {
                    show_main_window(&boot_handle);
                }
            });

            let _ = start_sidecar(&handle);
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show-logs" => {
                // Prefer the live dashboard so the in-app terminal view is
                // what opens. Fall back to the folder only when nothing is
                // answering — better than a dead menu item mid-boot.
                if let Some(base) = current_dashboard_origin(app) {
                    if let Some(window) = app.get_webview_window("main") {
                        let target = format!("{}/logs", base.trim_end_matches('/'));
                        if let Ok(url) = target.parse() {
                            let _ = window.navigate(url);
                            return;
                        }
                    }
                }
                if let Some(state) = app.try_state::<AppState>() {
                    let dir = state.paths.log_dir();
                    let _ = tauri_plugin_opener::open_path(
                        dir.to_string_lossy().to_string(),
                        None::<&str>,
                    );
                }
            }
            "open-logs-folder" => {
                if let Some(state) = app.try_state::<AppState>() {
                    let dir = state.paths.log_dir();
                    let _ = tauri_plugin_opener::open_path(
                        dir.to_string_lossy().to_string(),
                        None::<&str>,
                    );
                }
            }
            "reload" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.location.reload()");
                }
            }
            "rebuild-dashboard" => rebuild_dashboard(app),
            "check-updates" => {
                let _ = app.emit("devhub://check-updates", ());
            }
            /*
             * Toggle between the packaged server and a checkout server.
             *
             * Writing the preference then restarting gives the new server a
             * fresh browser session and keeps sidecar ownership unambiguous.
             * The stop work happens before the restart so the replacement
             * never races a listener that was supposed to be gone.
             */
            "toggle-dev-server" => {
                if let Some(file) = dev_server_pref_file(app) {
                    let currently_attached = dev_server_url_for(Some(app)).is_some();
                    if currently_attached {
                        if let Err(err) = stop_attached_dev_server(app) {
                            if let Some(state) = app.try_state::<AppState>() {
                                state.log.write_line(
                                    "shell:switch",
                                    &format!("[switch] packaged transition blocked: {err}"),
                                );
                            }
                            app.dialog()
                                .message(format!(
                                    "DevHub could not safely stop the development server.\n\n{err}"
                                ))
                                .title("Could not switch to packaged server")
                                .kind(MessageDialogKind::Warning)
                                .show(|_| {});
                            return;
                        }
                        let _ = std::fs::remove_file(&file);
                    } else {
                        if let Some(parent) = file.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        // The dev server uses the packaged server's ports, so
                        // stop the packaged sidecar before restarting. Startup
                        // will reuse a healthy checkout server or launch one.
                        let _ = std::fs::write(&file, "http://localhost:1337");
                    }
                    if let Some(state) = app.try_state::<AppState>() {
                        state.log.write_line(
                            "shell:switch",
                            if currently_attached {
                                "[switch] phase=starting-packaged-server"
                            } else {
                                "[switch] phase=starting-development-server"
                            },
                        );
                    }
                    // Tauri's restart can launch the replacement before the
                    // old process reaches its exit handler. Stop only our
                    // packaged child synchronously so it cannot briefly keep
                    // 1337/1339 and make the replacement fail at boot.
                    if !currently_attached {
                        if let Some(state) = app.try_state::<AppState>() {
                            state.sidecar.stop();
                        }
                    }
                    app.restart();
                }
            }
            _ => {}
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Stop the process group here rather than letting the process
                // exit take it: an orphaned Next server holding port 1337 is
                // the single most common way a desktop shell ruins the *next*
                // launch.
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    state.sidecar.stop();
                }
                stop_dev_server(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the DevHub shell")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.sidecar.stop();
                }
                stop_dev_server(app);
            }
        });
}

#[cfg(unix)]
extern "C" {
    #[link_name = "setsid"]
    fn libc_setsid() -> i32;
    #[link_name = "kill"]
    fn libc_kill(pid: i32, signal: i32) -> i32;
    #[link_name = "killpg"]
    fn libc_killpg(pgrp: i32, sig: i32) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn url(s: &str) -> tauri::Url {
        s.parse().unwrap()
    }

    /// The narrow "is this exactly the dashboard" rule. Only the tests need it
    /// now that the window guard allows any loopback service, but it still
    /// documents the distinction worth keeping in mind.
    fn is_dashboard_url(url: &tauri::Url, port: u16) -> bool {
        is_loopback_host(url) && url.port().unwrap_or(80) == port && matches!(url.scheme(), "http")
    }

    #[test]
    fn only_the_exact_dashboard_origin_is_allowed_in_the_window() {
        assert!(is_dashboard_url(&url("http://127.0.0.1:1337/"), 1337));
        assert!(is_dashboard_url(&url("http://localhost:1337/notes"), 1337));

        // A different port is a different app.
        assert!(!is_dashboard_url(&url("http://127.0.0.1:1338/"), 1337));
        // The prefix trap: this is a public domain, not loopback.
        assert!(!is_dashboard_url(&url("http://127.0.0.1.evil.com/"), 1337));
        assert!(!is_dashboard_url(
            &url("http://localhost.evil.com:1337/"),
            1337
        ));
        assert!(!is_dashboard_url(&url("https://github.com/"), 1337));
        assert!(!is_dashboard_url(&url("file:///etc/passwd"), 1337));
    }

    #[test]
    fn our_own_loopback_services_may_load_in_the_window() {
        // The regression this exists for: iframes to OpenChamber (1336),
        // OpenCode (1338) and the browser view were blocked, so all three
        // rendered as blank white panes.
        for port in [1336, 1337, 1338, 1339, 62537] {
            assert!(
                may_load_in_window(&url(&format!("http://localhost:{port}/")), 1337),
                "loopback:{port} should be allowed in the window"
            );
            assert!(may_load_in_window(
                &url(&format!("http://127.0.0.1:{port}/")),
                1337
            ));
        }
    }

    #[test]
    fn nothing_off_machine_may_load_in_the_window() {
        // Widening to loopback must not have widened it to the internet.
        for hostile in [
            "https://github.com/",
            "http://evil.example/",
            "http://127.0.0.1.evil.com/",
            "http://localhost.evil.com:1337/",
            "file:///etc/passwd",
        ] {
            assert!(
                !may_load_in_window(&url(hostile), 1337),
                "{hostile} must not load in the app window"
            );
        }
    }

    /// The boot page is plain HTML with no bundler, so it cannot import
    /// `@tauri-apps/api` — it reads `window.__TAURI__`, and that global only
    /// exists when `withGlobalTauri` is on. It was off, so the boot script threw
    /// on its first line and the page froze as static markup: no phase labels,
    /// no log lines, no failure UI, and three dead buttons. The app underneath
    /// was reporting a port conflict two seconds after launch to nobody.
    ///
    /// A one-word config regression is not something to rediscover twice.
    #[test]
    fn the_boot_page_has_a_tauri_global_to_talk_to() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["app"]["withGlobalTauri"],
            serde_json::Value::Bool(true),
            "boot/index.html reads window.__TAURI__; without withGlobalTauri it is undefined"
        );
    }

    #[test]
    fn bootstrap_tokens_are_long_and_never_repeat() {
        let a = new_bootstrap_token();
        let b = new_bootstrap_token();
        assert_eq!(a.len(), 64, "expected 32 bytes of hex");
        assert_ne!(a, b, "each launch must get a fresh token");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn attach_requires_a_healthy_http_server() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let size = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..size]);
            assert!(request.starts_with("GET /api/desktop/health HTTP/1.1"));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"devhub\":true}")
                .unwrap();
        });

        assert!(dev_server_responds(&format!("http://127.0.0.1:{port}")).is_ok());
    }

    #[test]
    fn attach_rejects_an_unhealthy_or_non_devhub_http_server() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
        });

        assert!(dev_server_responds(&format!("http://127.0.0.1:{port}")).is_err());

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
                .unwrap();
        });

        assert!(dev_server_responds(&format!("http://127.0.0.1:{port}")).is_err());
    }

    #[test]
    fn attach_parses_the_configured_dev_server_endpoint() {
        assert_eq!(
            dev_server_endpoint("http://localhost:1337").unwrap(),
            ("localhost".into(), 1337)
        );
        assert!(dev_server_endpoint("https://localhost:1337").is_err());
        assert!(dev_server_endpoint("not a URL").is_err());
    }

    #[test]
    fn attach_bootstrap_page_keeps_the_dev_server_origin() {
        assert_eq!(
            attach_dev_bootstrap_url("http://localhost:1337/worktree?stale=1")
                .unwrap()
                .as_str(),
            "http://localhost:1337/attach-dev.html"
        );
    }

    /// Every command line below was copied from `ps` on a machine where this
    /// actually went wrong, `next-server (v16.2.6)` included — Next rewrites its
    /// argv, so the process holding port 1337 identifies itself by version
    /// number and nothing else.
    #[test]
    fn our_own_dev_services_are_recognised_from_how_they_actually_look() {
        let dashboard = Path::new("/repo/dashboard");
        for command in [
            "next-server (v16.2.6)",
            "/n/bin/node /repo/dashboard/node_modules/next/dist/bin/next dev -p 1337 -H 127.0.0.1",
            "node /repo/dashboard/node_modules/.bin/tsx scripts/lan-port-proxy.ts",
            "/n/bin/node --require /repo/dashboard/node_modules/tsx/dist/preflight.cjs scripts/lan-port-proxy.ts",
            "node /repo/dashboard/node_modules/.bin/tsx scripts/terminal-pty-server.ts",
            "node /repo/dashboard/node_modules/.bin/tsx scripts/start-peer-services.ts",
            "node /repo/dashboard/node_modules/.bin/tsx scripts/run-next-with-env.ts dev",
        ] {
            assert!(
                is_checkout_dev_process(command, Some(dashboard), dashboard),
                "should be recognised as ours: {command}"
            );
        }
    }

    /// The two halves of the fingerprint both have to matter, or this becomes a
    /// licence to kill whatever is on the port.
    #[test]
    fn a_process_is_only_ours_when_both_the_command_and_the_directory_agree() {
        let dashboard = Path::new("/repo/dashboard");
        let ours = "node /repo/dashboard/node_modules/.bin/tsx scripts/lan-port-proxy.ts";

        // Right command, wrong checkout: this is somebody else's worktree, and
        // adopting or killing it has been a bug before.
        assert!(!is_checkout_dev_process(
            ours,
            Some(Path::new("/other-repo/dashboard")),
            dashboard
        ));
        // Right directory, unrelated command: a shell left sitting in the
        // dashboard folder is not a dev server.
        assert!(!is_checkout_dev_process(
            "/bin/zsh -i",
            Some(dashboard),
            dashboard
        ));
        // No cwd readable at all — refuse rather than guess.
        assert!(!is_checkout_dev_process(ours, None, dashboard));
    }

    #[test]
    fn genuinely_foreign_processes_are_never_classified_as_ours() {
        let dashboard = Path::new("/repo/dashboard");
        for command in [
            "/usr/local/bin/some-other-server --port 1337",
            "python3 -m http.server 1337",
            "/Applications/Docker.app/Contents/Resources/bin/com.docker.backend",
        ] {
            assert!(
                !is_checkout_dev_process(command, Some(dashboard), dashboard),
                "must not be treated as ours: {command}"
            );
        }
    }

    /// The bug in the copy: `scripts/lan-port-proxy.ts` from this very checkout
    /// was reported as "another program's process", with an instruction to go
    /// find and quit it by hand.
    #[test]
    fn our_own_leftover_is_owned_up_to_rather_than_disowned() {
        let holder = PortHolder {
            pid: 84174,
            command: "node /repo/dashboard/node_modules/.bin/tsx scripts/lan-port-proxy.ts".into(),
            ours: true,
            desktop_app: false,
        };
        let message = port_conflict_message(1337, Some(&holder));
        assert!(
            message.contains("84174"),
            "must name the process: {message}"
        );
        assert!(
            message.contains("leftover DevHub development server"),
            "must admit it is ours: {message}"
        );
        assert!(
            !message.contains("another program"),
            "our own dev helper is not another program: {message}"
        );
    }

    #[test]
    fn an_unrelated_program_on_our_port_is_named_but_never_offered_up_for_killing() {
        let holder = PortHolder {
            pid: 999,
            command: "/usr/local/bin/some-other-server --port 1337".into(),
            ours: false,
            desktop_app: false,
        };
        let message = port_conflict_message(1337, Some(&holder));
        assert!(message.contains("999"));
        assert!(message.contains("some-other-server"));
        assert!(
            message.contains("will not stop"),
            "a stranger's process is refused, not offered: {message}"
        );
    }

    #[test]
    fn an_unidentifiable_holder_still_gets_an_actionable_message() {
        let message = port_conflict_message(1337, None);
        assert!(
            message.contains("lsof"),
            "with no PID to name, hand over the command that finds it: {message}"
        );
    }

    #[test]
    fn a_second_devhub_is_reported_as_a_second_devhub() {
        let holder = PortHolder {
            pid: 4242,
            command: "node /Applications/DevHub.app/Contents/Resources/server/server.js".into(),
            ours: false,
            desktop_app: true,
        };
        let message = port_conflict_message(1337, Some(&holder));
        assert!(message.contains("Another DevHub"));
        assert!(
            !message.contains("will not stop"),
            "a second app is quit from its own window, not refused as a stranger: {message}"
        );
    }

    /// The orphan this classification exists for: `next start` outliving the
    /// app that spawned it, still answering the health route.
    ///
    /// It was read as a second DevHub, so the user was told to quit a window
    /// that had closed an hour earlier — and because the stop offer was gated
    /// on *not* being a second DevHub, the one button that would have cleared
    /// the port was hidden. Ownership is a property of the process.
    #[test]
    fn an_orphaned_checkout_server_is_owned_rather_than_mistaken_for_an_app() {
        let holder = PortHolder {
            pid: 76709,
            command: "next-server (v16.2.6)".into(),
            ours: true,
            desktop_app: false,
        };
        let message = port_conflict_message(1337, Some(&holder));
        assert!(
            message.contains("leftover DevHub development server"),
            "an orphan from our own checkout is ours to own: {message}"
        );
        assert!(
            !message.contains("window that is already open"),
            "there is no window: the app that spawned it is gone: {message}"
        );
    }

    #[test]
    fn a_sidecar_under_the_app_bundle_is_recognised_as_another_devhub() {
        // The listener's own argv gives nothing away — the bundle is upstream.
        assert!(is_desktop_app_chain(&[
            "next-server (v16.2.6)".into(),
            "node /Applications/DevHub.app/Contents/Resources/server/server.js".into(),
            "/Applications/DevHub.app/Contents/MacOS/devhub-desktop".into(),
        ]));
    }

    #[test]
    fn an_ordinary_node_tree_is_not_another_devhub() {
        assert!(!is_desktop_app_chain(&[
            "next-server (v16.2.6)".into(),
            "npm exec next start -p 1337 -H 0.0.0.0".into(),
            "/bin/zsh".into(),
        ]));
        assert!(!is_desktop_app_chain(&[]));
    }

    #[test]
    fn conflict_messages_stay_short_enough_to_read() {
        let holder = PortHolder {
            pid: 1,
            command: "x".repeat(4000),
            ours: false,
            desktop_app: false,
        };
        let message = port_conflict_message(1337, Some(&holder));
        assert!(
            message.chars().count() < 400,
            "a dialog is not a log file: {} chars",
            message.chars().count()
        );
    }

    /// `npm run dev` puts two listeners on 1337 and `lsof` order is arbitrary.
    /// Picking the wrong one is how the LAN proxy got described as a stranger.
    #[test]
    fn the_listener_we_recognise_is_the_one_we_report() {
        let pick = |holders: Vec<PortHolder>| {
            holders
                .into_iter()
                .reduce(|best, next| {
                    if holder_rank(&next) > holder_rank(&best) {
                        next
                    } else {
                        best
                    }
                })
                .map(|h| h.pid)
        };
        let foreign = || PortHolder {
            pid: 1,
            command: "stranger".into(),
            ours: false,
            desktop_app: false,
        };
        let mine = || PortHolder {
            pid: 2,
            command: "ours".into(),
            ours: true,
            desktop_app: false,
        };
        let other_app = || PortHolder {
            pid: 3,
            command: "another devhub".into(),
            ours: false,
            desktop_app: true,
        };

        assert_eq!(pick(vec![foreign(), mine()]), Some(2));
        assert_eq!(pick(vec![mine(), foreign()]), Some(2));
        assert_eq!(pick(vec![foreign()]), Some(1));
        assert_eq!(pick(vec![]), None);
        // A stranger sharing the port with a DevHub says less than the DevHub.
        assert_eq!(pick(vec![foreign(), other_app()]), Some(3));
        assert_eq!(pick(vec![other_app(), foreign()]), Some(3));
        // Our own leftover still outranks it: only that one can be cleaned up.
        assert_eq!(pick(vec![other_app(), mine()]), Some(2));
        assert_eq!(pick(vec![mine(), other_app()]), Some(2));
    }

    /// A failure only advertises the stop button when the shell decided the
    /// listener was ours. The page must not be able to conjure it up.
    #[test]
    fn only_a_failure_over_our_own_leftover_offers_to_stop_it() {
        let offered = BootState::Failed {
            error: "port held".into(),
            logs: vec![],
            stoppable_dev_server: true,
        };
        let refused = BootState::Failed {
            error: "port held".into(),
            logs: vec![],
            stoppable_dev_server: false,
        };
        let json = |state: &BootState| serde_json::to_value(state).unwrap();
        assert_eq!(json(&offered)["stoppable_dev_server"], true);
        assert_eq!(json(&refused)["stoppable_dev_server"], false);
    }

    #[test]
    fn starting_label_carries_elapsed_seconds_for_the_boot_page() {
        assert_eq!(
            starting_service_label("dev-server", Duration::from_secs(45)),
            "dev-server:45"
        );
    }

    /// `localhost` resolves to `::1` first while the server binds IPv4 only.
    /// Connecting to just the first address is what made Rebuild report
    /// "Connection refused" at a dashboard that was running fine.
    #[test]
    fn connect_loopback_falls_through_to_the_address_that_listens() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(
            connect_loopback("localhost", port, Duration::from_secs(2)).is_ok(),
            "IPv4-only listener must still be reachable via `localhost`"
        );
    }

    /// `next dev` dribbles the status line out first and then chunk-frames the
    /// body, so JSON-parsing whatever followed the first `\r\n\r\n` failed on
    /// every poll and attach never left the boot screen.
    #[test]
    fn dev_server_health_survives_a_fragmented_chunked_response() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().take(1).flatten() {
                let mut request = Vec::new();
                let mut chunk = [0_u8; 512];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(read) => request.extend_from_slice(&chunk[..read]),
                    }
                }
                // Headers first, body later, and chunk-framed when it arrives.
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n",
                );
                std::thread::sleep(Duration::from_millis(30));
                let _ = stream.write_all(
                    b"2f\r\n{\"devhub\":true,\"desktop\":false,\"status\":\"browser\"}\r\n0\r\n\r\n",
                );
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }
        });

        assert!(dev_server_responds(&format!("http://127.0.0.1:{port}")).is_ok());
    }
}
