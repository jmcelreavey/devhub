//! What keeps scheduled jobs running when nobody is looking at DevHub: the
//! root wake helper, and launching at login.
//!
//! The helper install is the classic privileged-helper shape — copy a binary
//! to /Library/PrivilegedHelperTools and load a LaunchDaemon, behind the macOS
//! admin prompt — rather than `SMAppService.daemon`. SMAppService ties the
//! daemon to the app bundle's code signature, and local DevHub builds change
//! that signature on every rebuild; the installed copy here is independent of
//! the bundle, so rebuilding DevHub never silently breaks wakes.
//!
//! Paths reach the root shell only as `osascript` arguments quoted by
//! AppleScript's `quoted form of`, never spliced into the script text.

use std::process::Command;
use tauri::{AppHandle, Manager};

/// Desktop log (View → Show Logs), next to the scheduler's own lines.
fn log(app: &AppHandle, line: &str) {
    if let Some(state) = app.try_state::<crate::AppState>() {
        state.log.write_line("shell:background", line);
    }
}

#[cfg(target_os = "macos")]
fn log_outcome(app: &AppHandle, what: &str, result: &Result<(), String>) {
    match result {
        Ok(()) => log(app, &format!("[wake-helper] {what} succeeded")),
        Err(err) if err == "Cancelled" => log(
            app,
            &format!("[wake-helper] {what} cancelled at the admin prompt"),
        ),
        Err(err) => log(app, &format!("[wake-helper] {what} failed: {err}")),
    }
}

#[cfg(target_os = "macos")]
const INSTALL_SCRIPT: &[&str] = &[
    "on run argv",
    "do shell script \"/bin/launchctl bootout system/com.devhub.wake-helper >/dev/null 2>&1; /bin/sleep 1; /bin/mkdir -p /Library/PrivilegedHelperTools && /usr/bin/install -o root -g wheel -m 0755 \" & quoted form of (item 1 of argv) & \" /Library/PrivilegedHelperTools/com.devhub.wake-helper && /usr/bin/install -o root -g wheel -m 0644 \" & quoted form of (item 2 of argv) & \" /Library/LaunchDaemons/com.devhub.wake-helper.plist && /bin/launchctl bootstrap system /Library/LaunchDaemons/com.devhub.wake-helper.plist\" with prompt \"DevHub wants to install a small helper that wakes this Mac for scheduled jobs.\" with administrator privileges",
    "end run",
];

#[cfg(target_os = "macos")]
const UNINSTALL_SCRIPT: &[&str] = &[
    "do shell script \"echo cancel | /usr/bin/nc -U -w 2 /var/run/com.devhub.wake-helper.sock >/dev/null 2>&1; /bin/launchctl bootout system/com.devhub.wake-helper >/dev/null 2>&1; /bin/rm -f /Library/LaunchDaemons/com.devhub.wake-helper.plist /Library/PrivilegedHelperTools/com.devhub.wake-helper /var/run/com.devhub.wake-helper.sock\" with prompt \"DevHub wants to remove its wake helper.\" with administrator privileges",
];

#[cfg(target_os = "macos")]
fn run_osascript(lines: &[&str], args: &[&std::ffi::OsStr]) -> Result<(), String> {
    let mut cmd = Command::new("/usr/bin/osascript");
    for line in lines {
        cmd.arg("-e").arg(line);
    }
    cmd.args(args);
    let output = cmd
        .output()
        .map_err(|e| format!("could not run osascript: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("-128") {
        return Err("Cancelled".into());
    }
    Err(stderr.trim().to_string())
}

#[tauri::command]
pub async fn wake_helper_install(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let dir = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("wake-helper");
        let binary = dir.join("devhub-wake-helper");
        let plist = dir.join("com.devhub.wake-helper.plist");
        if !binary.exists() || !plist.exists() {
            let message = "This build does not include the wake helper — build the app with npm run desktop:build.";
            log(&app, &format!("[wake-helper] install refused: {message}"));
            return Err(message.into());
        }
        log(
            &app,
            "[wake-helper] install requested — showing the macOS admin prompt",
        );
        let result = tauri::async_runtime::spawn_blocking(move || {
            run_osascript(INSTALL_SCRIPT, &[binary.as_os_str(), plist.as_os_str()])
        })
        .await
        .map_err(|e| e.to_string())?;
        log_outcome(&app, "install", &result);
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Waking the computer is only supported on macOS".into())
    }
}

#[tauri::command]
pub async fn wake_helper_uninstall(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        log(
            &app,
            "[wake-helper] uninstall requested — showing the macOS admin prompt",
        );
        let result = tauri::async_runtime::spawn_blocking(|| run_osascript(UNINSTALL_SCRIPT, &[]))
            .await
            .map_err(|e| e.to_string())?;
        log_outcome(&app, "uninstall", &result);
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Waking the computer is only supported on macOS".into())
    }
}

/// `"enabled" | "disabled" | "requires-approval" | "unsupported"`.
#[tauri::command]
pub fn login_item_status() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        login_item::status().map(str::to_string)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("unsupported".into())
    }
}

#[tauri::command]
pub fn login_item_set(app: AppHandle, enabled: bool) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let result = login_item::set(enabled).map(str::to_string);
        match &result {
            Ok(status) => log(
                &app,
                &format!("[login-item] set enabled={enabled} → {status}"),
            ),
            Err(err) => log(
                &app,
                &format!("[login-item] set enabled={enabled} failed: {err}"),
            ),
        }
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, enabled);
        Err("Launch at login is only supported on macOS".into())
    }
}

/// `SMAppService.mainAppService` — the system's own "Open at Login" entry.
#[cfg(target_os = "macos")]
mod login_item {
    use cocoa::base::{id, nil};
    use objc::runtime::{Class, BOOL, YES};
    use objc::{msg_send, sel, sel_impl};
    use std::ffi::CStr;
    use std::os::raw::c_char;

    #[link(name = "ServiceManagement", kind = "framework")]
    extern "C" {}

    fn main_app_service() -> Result<id, String> {
        // SMAppService is macOS 13+; the bundle still supports 11.
        let class = Class::get("SMAppService").ok_or("Launch at login needs macOS 13 or later")?;
        Ok(unsafe { msg_send![class, mainAppService] })
    }

    pub fn status() -> Result<&'static str, String> {
        let Ok(service) = main_app_service() else {
            return Ok("unsupported");
        };
        let status: isize = unsafe { msg_send![service, status] };
        Ok(match status {
            1 => "enabled",
            2 => "requires-approval",
            _ => "disabled",
        })
    }

    pub fn set(enabled: bool) -> Result<&'static str, String> {
        let service = main_app_service()?;
        let mut error: id = nil;
        let ok: BOOL = unsafe {
            if enabled {
                msg_send![service, registerAndReturnError: &mut error as *mut id]
            } else {
                msg_send![service, unregisterAndReturnError: &mut error as *mut id]
            }
        };
        if ok != YES {
            return Err(describe(error));
        }
        status()
    }

    fn describe(error: id) -> String {
        if error == nil {
            return "unknown error".into();
        }
        unsafe {
            let description: id = msg_send![error, localizedDescription];
            let utf8: *const c_char = msg_send![description, UTF8String];
            if utf8.is_null() {
                return "unknown error".into();
            }
            CStr::from_ptr(utf8).to_string_lossy().into_owned()
        }
    }
}
