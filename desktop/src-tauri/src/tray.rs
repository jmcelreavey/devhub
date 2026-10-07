//! macOS menu-bar status item while the main window is hidden.
//!
//! Close hides the window but keeps the sidecar running; the tray icon is the
//! affordance to bring DevHub back without hunting the Dock.

#[cfg(target_os = "macos")]
pub(crate) const TRAY_ID: &str = "devhub-status";

#[cfg(any(target_os = "macos", windows))]
fn menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let show = MenuItem::with_id(app, "tray-show-devhub", "Open DevHub", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray-hide-devhub", "Hide DevHub", true, None::<&str>)?;
    let restart = MenuItem::with_id(
        app,
        "tray-restart-backend",
        "Restart Backend",
        crate::dev_server_url_for(Some(app)).is_none(),
        None::<&str>,
    )?;
    let logs = MenuItem::with_id(
        app,
        "open-logs-folder",
        "Open Logs Folder",
        true,
        None::<&str>,
    )?;
    let updates = MenuItem::with_id(
        app,
        "check-updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "tray-quit-devhub", "Quit DevHub", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &PredefinedMenuItem::separator(app)?,
            &restart,
            &logs,
            &updates,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

#[cfg(target_os = "macos")]
pub(crate) fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let menu = menu(app)?;

    // Black-on-transparent silhouette (@2x). Full-colour Dock icons flatten to a
    // muddy square when marked as template — menu-bar needs a real glyph.
    let icon = Image::from_bytes(include_bytes!("../icons/trayTemplate@2x.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("DevHub")
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_main_window(tray.app_handle());
                set_visible(tray.app_handle(), false);
            }
        })
        .build(app)?;

    // Visible only while the window is hidden (see `set_visible`).
    set_visible(app, false);
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn set_visible(app: &tauri::AppHandle, visible: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(visible);
    }
}

/// Windows: a permanent notification-area icon, because closing the window
/// hides it and the server keeps running (scheduled jobs, agents). Unlike the
/// macOS status item it never hides — an app that is running with no window and
/// no icon is one the user cannot find to quit.
#[cfg(windows)]
pub(crate) fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};

    let menu = menu(app)?;

    let mut builder = tauri::tray::TrayIconBuilder::with_id("devhub-status")
        .tooltip("DevHub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn install(_app: &tauri::AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)] // called from macOS-only sites; kept so callers need no cfg
pub(crate) fn set_visible(_app: &tauri::AppHandle, _visible: bool) {}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(target_os = "macos")]
    fn tray_id_is_stable() {
        assert_eq!(super::TRAY_ID, "devhub-status");
    }
}
