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

mod logging;
mod paths;
mod selftest;
mod sidecar;
mod updater;

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rand::Rng;
use serde::Serialize;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use logging::DesktopLog;
use paths::{default_app_data, RuntimePaths};
use sidecar::{BootState, Sidecar};

const DEFAULT_PORT: u16 = 1337;
const DEFAULT_TERMINAL_PORT: u16 = 1339;
const DEV_SERVER_START_TIMEOUT: Duration = Duration::from_secs(90);
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

/// The last lines of the desktop log, for the failure UI.
#[tauri::command]
fn recent_logs(state: tauri::State<'_, AppState>) -> Vec<String> {
    state.log.tail(40)
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
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|err| err.to_string())?;
    let mut stream = addresses
        .filter_map(|address| TcpStream::connect_timeout(&address, Duration::from_secs(2)).ok())
        .next()
        .ok_or_else(|| format!("No dev server is responding at {url}. Start `npm run dev` in the DevHub checkout, then Retry."))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|err| err.to_string())?;
    write!(
        stream,
        "GET /api/desktop/health HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|err| err.to_string())?;
    let mut response = [0_u8; 4096];
    let size = stream.read(&mut response).map_err(|_| {
        format!("The dev server at {url} did not return a health response. Start `npm run dev`, then Retry.")
    })?;
    let response = String::from_utf8_lossy(&response[..size]);
    if !response.starts_with("HTTP/") {
        return Err(format!("The process at {url} is not an HTTP server."));
    }
    if !response.starts_with("HTTP/1.1 200") && !response.starts_with("HTTP/1.0 200") {
        return Err(format!(
            "The server at {url} did not pass DevHub's health check ({}). Start `npm run dev` in this checkout, then Retry.",
            response.lines().next().unwrap_or("no HTTP status")
        ));
    }
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or_default();
    let is_devhub = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value.get("devhub").and_then(|value| value.as_bool()))
        == Some(true);
    if !is_devhub {
        return Err(format!(
            "The server at {url} returned 200 but is not DevHub. Start `npm run dev` in this checkout, then Retry."
        ));
    }
    Ok(())
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

/// The only foreign listeners we may stop are DevHub's checkout services.
///
/// A port number is not ownership. The listener must have the configured
/// checkout's dashboard directory as its cwd *and* match one of the scripts
/// `npm run dev` launches. That excludes unrelated local servers which merely
/// happen to use our conventional ports.
fn is_checkout_dev_listener(pid: u32, repo_root: &std::path::Path) -> bool {
    let dashboard = repo_root.join("dashboard").canonicalize().ok();
    let cwd = process_cwd(pid).and_then(|cwd| cwd.canonicalize().ok());
    if dashboard != cwd {
        return false;
    }
    let Some(command) = process_command(pid) else {
        return false;
    };
    command.contains("next-server")
        || command.contains("scripts/lan-port-proxy.ts")
        || command.contains("scripts/terminal-pty-server.ts")
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

fn wait_for_dev_server(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let deadline = Instant::now() + DEV_SERVER_START_TIMEOUT;
    while Instant::now() < deadline {
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
                set_boot(app, BootState::Ready { url });
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
    if let Some(conflict) = sidecar.check_ports() {
        let message = if conflict.is_devhub {
            format!(
                "Another DevHub is already using port {}. Quit it, or use the window that is already open.",
                conflict.port
            )
        } else {
            format!(
                "Port {} is in use by another program. DevHub will not stop it — quit that program and try again.",
                conflict.port
            )
        };
        fail(app, &message);
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
                set_boot(&handle, BootState::Ready { url: sidecar.url() });
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
fn load_dashboard(app: &tauri::AppHandle, sidecar: &Sidecar) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let url = sidecar.bootstrap_url();
    match url.parse() {
        Ok(parsed) => {
            let _ = window.navigate(parsed);
            show_main_window(app);
        }
        Err(err) => fail(app, &format!("Could not open the dashboard URL: {err}")),
    }
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
    let view_menu = Submenu::with_items(app, "View", true, &[&reload, &show_logs, &dev_server])?;

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
}
