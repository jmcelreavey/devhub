fn main() {
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
            "quit_app",
            "set_desktop_icon",
            "wake_helper_install",
            "wake_helper_uninstall",
            "login_item_status",
            "login_item_set",
            "current_version",
            "check_update",
            "install_update",
            "relaunch",
        ]),
    ))
    .expect("failed to run tauri-build");
}
