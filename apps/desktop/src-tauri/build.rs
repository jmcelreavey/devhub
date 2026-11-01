use std::process::{Command, Stdio};

fn git_output(args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8(output.stdout).ok()?.trim().to_owned())
}

fn main() {
    if let Some(head) = git_output(&["rev-parse", "--git-path", "HEAD"]) {
        println!("cargo:rerun-if-changed={head}");
    }
    // HEAD normally names a branch, so a new commit changes the ref, not HEAD.
    if let Some(reference) = git_output(&["symbolic-ref", "-q", "HEAD"]) {
        if let Some(path) = git_output(&["rev-parse", "--git-path", &reference]) {
            println!("cargo:rerun-if-changed={path}");
        }
    }
    let commit_secs = git_output(&["log", "-1", "--format=%ct", "HEAD"])
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    println!("cargo:rustc-env=DEVHUB_BUILD_COMMIT_SECS={commit_secs}");

    // Declaring app commands generates an `allow-<command>` permission for each.
    // Without it, remote origins — the dashboard at 127.0.0.1:1337 is one — are
    // refused every app command by the ACL. Grants live in capabilities/.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "boot_state",
            "recent_logs",
            "open_logs",
            "pick_folder",
            "desktop_info",
            "renderer_log",
            "retry_start",
            "stop_conflicting_dev_server",
            "install_wsl",
            "quit_app",
            "set_desktop_icon",
            "wake_helper_install",
            "wake_helper_uninstall",
            "login_item_status",
            "login_item_set",
            "current_version",
            "check_update",
            "check_update_outcome",
            "install_update",
            "relaunch",
        ]),
    ))
    .expect("failed to run tauri-build");
}
