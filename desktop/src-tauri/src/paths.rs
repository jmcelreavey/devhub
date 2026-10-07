//! The runtime path contract, Rust side.
//!
//! This must agree with `dashboard/lib/desktop/runtime-paths.ts`. They are two
//! implementations of one contract, and the reason both exist is that Rust owns
//! process startup while TypeScript owns everything after it. The environment
//! built here is the only thing that connects them, so it is built in one
//! function rather than scattered across the spawn sites.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Directories created under app data. Shared with the WSL backend, which has
/// to create the same tree on the Linux side of the boundary.
pub const APP_DATA_SUBDIRS: [&str; 8] = [
    "config",
    "notes",
    "tasks",
    "collections",
    "upstarts",
    "docs",
    "persona",
    "logs",
];

/// Read-only packaged assets, writable user data, and where the server lives.
#[derive(Debug, Clone)]
pub struct RuntimePaths {
    /// Writable. Never replaced by an update.
    pub app_data: PathBuf,
    /// Read-only. Replaced wholesale by every update.
    pub resource_root: PathBuf,
    /// Next standalone output (contains `server.js`).
    pub server_dir: PathBuf,
    /// Compiled sidecar entrypoints.
    pub services_dir: PathBuf,
    /// The bundled Node runtime.
    pub node_bin: PathBuf,
}

impl RuntimePaths {
    pub fn log_dir(&self) -> PathBuf {
        self.app_data.join("logs")
    }

    pub fn supervisor(&self) -> PathBuf {
        self.services_dir.join("supervisor.mjs")
    }

    /// Create the writable tree at `0700`.
    ///
    /// `config/.env.local` holds API tokens and `logs/` holds verbatim terminal
    /// transcripts. On a shared machine neither should be readable by another
    /// account, and this is the one place that can enforce it before anything
    /// writes.
    pub fn ensure_app_data(&self) -> std::io::Result<()> {
        for sub in APP_DATA_SUBDIRS {
            std::fs::create_dir_all(self.app_data.join(sub))?;
        }
        restrict_permissions(&self.app_data)?;
        restrict_permissions(&self.app_data.join("config"))?;
        restrict_permissions(&self.app_data.join("logs"))?;
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    if !path.exists() {
        return Ok(());
    }
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> std::io::Result<()> {
    // Windows ACLs are not mode bits; the equivalent belongs in the installer.
    Ok(())
}

/// The environment every sidecar child runs with.
///
/// Two categories, and conflating them was a real bug:
///
/// - **Infrastructure** — app data, resource root, server dir, ports, the
///   bootstrap token. The shell owns these absolutely; `supervisor.mjs` refuses
///   to let the config file change them.
/// - **Defaults for user preferences** — the content directories below. These
///   are what a *fresh* install should use, and the user's own config
///   (`DEVHUB_ENV_FILE`) overrides them.
///
/// The second half is not optional. Setting `NOTES_DIR` here and treating it as
/// authoritative meant a user who migrated with "keep my notes where they are"
/// opened the app to an empty vault: their choice was recorded, then ignored.
/// The data was never at risk, but it looked exactly like data loss.
pub fn sidecar_env(
    paths: &RuntimePaths,
    port: u16,
    terminal_port: u16,
    bootstrap_token: &str,
) -> BTreeMap<String, String> {
    sidecar_env_for(
        &SidecarDirs {
            app_data: path_string(&paths.app_data),
            resource_root: path_string(&paths.resource_root),
            server_dir: path_string(&paths.server_dir),
            checkout: None,
        },
        port,
        terminal_port,
        bootstrap_token,
    )
}

/// The three roots the sidecar environment derives from, as plain strings.
///
/// Strings rather than `PathBuf`s because the WSL backend hands the sidecar
/// *Linux* paths from a Windows process. `PathBuf::join` on Windows would build
/// `/home/me/.local/share/devhub\notes`; joining with `/` here is correct for
/// every target that runs a sidecar, since none of them run one natively on
/// Windows.
pub struct SidecarDirs {
    pub app_data: String,
    pub resource_root: String,
    pub server_dir: String,
    /// A real git checkout to run *against*: its notes, tasks and `.env.local`
    /// become the live data, exactly as `npm run dev` in that checkout would
    /// see them. `None` is a fresh, self-contained install.
    pub checkout: Option<String>,
}

pub fn sidecar_env_for(
    dirs: &SidecarDirs,
    port: u16,
    terminal_port: u16,
    bootstrap_token: &str,
) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    let mut set = |k: &str, v: String| {
        env.insert(k.to_string(), v);
    };
    let under_app_data = |sub: &str| format!("{}/{sub}", dirs.app_data);

    set("DEVHUB_DESKTOP", "1".into());
    set("DEVHUB_APP_DATA", dirs.app_data.clone());
    set("DEVHUB_RESOURCE_ROOT", dirs.resource_root.clone());
    set("DEVHUB_SERVER_DIR", dirs.server_dir.clone());
    set("DEVHUB_ENV_FILE", under_app_data("config/.env.local"));
    set("DEVHUB_OP_CACHE_DIR", under_app_data("config"));

    // Defaults only — see the note above. DEVHUB_ENV_FILE overrides these.
    set("NOTES_DIR", under_app_data("notes"));
    set("TASKS_DIR", under_app_data("tasks"));
    set("COLLECTIONS_DIR", under_app_data("collections"));
    set("UPSTARTS_DIR", under_app_data("upstarts"));
    set("DOCS_DIR", under_app_data("docs"));
    set(
        "DEVHUB_IDENTITY_FILE",
        under_app_data("persona/identity.txt"),
    );

    // Linked checkout: the user's existing data and integration credentials
    // live there, and a server that ignores them looks like data loss (empty
    // Tasks, Paseo asking for a password it was never given).
    if let Some(repo) = dirs.checkout.as_deref().map(|r| r.trim_end_matches('/')) {
        let under_repo = |sub: &str| format!("{repo}/{sub}");
        set("REPO_ROOT", repo.to_string());
        if let Some((parent, _)) = repo.rsplit_once('/') {
            set("DEVHUB_REPOS_DIR", parent.to_string());
        }
        set("DEVHUB_ENV_FILE", under_repo("dashboard/.env.local"));
        set("NOTES_DIR", under_repo("notes"));
        set("TASKS_DIR", under_repo("tasks"));
        set("COLLECTIONS_DIR", under_repo("collections"));
        set("UPSTARTS_DIR", under_repo("upstarts"));
        set("DOCS_DIR", under_repo("docs"));
        set("DEVHUB_IDENTITY_FILE", under_repo("persona/identity.txt"));
    }

    set("PORT", port.to_string());
    set("TERMINAL_PORT", terminal_port.to_string());
    // Loopback only. LAN exposure is an explicit, separately configured proxy —
    // never something a fresh install turns on by default.
    set("DEVHUB_BIND_HOST", "127.0.0.1".into());
    set("NODE_ENV", "production".into());
    set("DEVHUB_BOOTSTRAP_TOKEN", bootstrap_token.to_string());

    env
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// OS-conventional app data location, matching `defaultAppDataDir()` in TS.
pub fn default_app_data(home: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home.join("Library")
            .join("Application Support")
            .join("DevHub")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
            .join("DevHub")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"))
            .join("devhub")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(root: &Path) -> RuntimePaths {
        RuntimePaths {
            app_data: root.join("data"),
            resource_root: root.join("res"),
            server_dir: root.join("res").join("server"),
            services_dir: root.join("res").join("services"),
            node_bin: root.join("node"),
        }
    }

    #[test]
    fn every_content_dir_lives_under_app_data() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = fixture(tmp.path());
        let env = sidecar_env(&paths, 1337, 1339, "t");
        let app_data = path_string(&paths.app_data);

        // The property that makes auto-update safe: nothing the user can write
        // to may resolve inside the replaceable resource tree.
        for key in [
            "NOTES_DIR",
            "TASKS_DIR",
            "COLLECTIONS_DIR",
            "UPSTARTS_DIR",
            "DOCS_DIR",
            "DEVHUB_IDENTITY_FILE",
            "DEVHUB_ENV_FILE",
        ] {
            let value = env.get(key).unwrap_or_else(|| panic!("{key} must be set"));
            assert!(
                value.starts_with(&app_data),
                "{key} = {value} must live under app data ({app_data})"
            );
        }
    }

    #[test]
    fn no_writable_dir_lives_under_the_resource_root() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = fixture(tmp.path());
        let env = sidecar_env(&paths, 1337, 1339, "t");
        let res = path_string(&paths.resource_root);
        for key in ["NOTES_DIR", "TASKS_DIR", "UPSTARTS_DIR", "DEVHUB_ENV_FILE"] {
            assert!(
                !env[key].starts_with(&res),
                "{key} must not resolve inside the read-only resource root"
            );
        }
    }

    fn dirs(checkout: Option<&str>) -> SidecarDirs {
        SidecarDirs {
            app_data: "/home/me/.local/share/devhub".into(),
            resource_root: "/rt/resources".into(),
            server_dir: "/rt/server".into(),
            checkout: checkout.map(str::to_string),
        }
    }

    #[test]
    fn a_linked_checkout_supplies_the_data_and_the_env_file() {
        let env = sidecar_env_for(&dirs(Some("/home/me/dev/devhub/")), 1337, 1339, "t");
        assert_eq!(env["REPO_ROOT"], "/home/me/dev/devhub");
        assert_eq!(env["DEVHUB_REPOS_DIR"], "/home/me/dev");
        assert_eq!(env["TASKS_DIR"], "/home/me/dev/devhub/tasks");
        assert_eq!(env["NOTES_DIR"], "/home/me/dev/devhub/notes");
        assert_eq!(
            env["DEVHUB_ENV_FILE"],
            "/home/me/dev/devhub/dashboard/.env.local"
        );
        // Logs and other app-owned state still live in app data.
        assert_eq!(env["DEVHUB_APP_DATA"], "/home/me/.local/share/devhub");
    }

    #[test]
    fn without_a_checkout_nothing_points_at_one() {
        let env = sidecar_env_for(&dirs(None), 1337, 1339, "t");
        assert!(!env.contains_key("REPO_ROOT"));
        assert_eq!(env["TASKS_DIR"], "/home/me/.local/share/devhub/tasks");
        assert_eq!(
            env["DEVHUB_ENV_FILE"],
            "/home/me/.local/share/devhub/config/.env.local"
        );
    }

    #[test]
    fn binds_loopback_only() {
        let tmp = tempfile::tempdir().unwrap();
        let env = sidecar_env(&fixture(tmp.path()), 1337, 1339, "t");
        assert_eq!(env["DEVHUB_BIND_HOST"], "127.0.0.1");
    }

    #[test]
    fn ensure_app_data_creates_the_whole_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = fixture(tmp.path());
        paths.ensure_app_data().unwrap();
        for sub in [
            "config",
            "notes",
            "tasks",
            "collections",
            "upstarts",
            "logs",
        ] {
            assert!(paths.app_data.join(sub).is_dir(), "{sub} should exist");
        }
    }

    #[cfg(unix)]
    #[test]
    fn app_data_is_not_world_readable() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let paths = fixture(tmp.path());
        paths.ensure_app_data().unwrap();
        let mode = std::fs::metadata(&paths.app_data)
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "app data must not be group/other readable");
    }
}
