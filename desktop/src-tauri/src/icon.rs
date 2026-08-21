//! Runtime OS icon — window, Dock, and (if we ever grow one) tray.
//!
//! The bundled `.icns` is the DevHub bottle. Plugin branding overlays the Dock
//! at runtime. macOS's persistent Dock tile reads `CFBundleIconFile`, so a
//! BI-branded *bundle* made `setApplicationIconImage` a no-op when switching
//! back to default. Resetting default uses `nil` (restore the bundle icon).

use serde::Deserialize;
use std::path::PathBuf;
use tauri::image::Image;
use tauri::{AppHandle, Manager};

/// Committed DevHub bottle. Not the staged plugin icon, not a path the
/// webview gets to name — the one file that makes "switch back to default"
/// actually mean default.
const DEFAULT_ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";
const MAX_PNG_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopIconKind {
    Default,
    Plugin,
}

pub fn validate_png(png: &[u8]) -> Result<(), String> {
    if png.len() > MAX_PNG_BYTES {
        return Err("Icon too large".into());
    }
    if png.len() < PNG_MAGIC.len() || !png.starts_with(PNG_MAGIC) {
        return Err("Icon must be a PNG".into());
    }
    Ok(())
}

fn plugin_png_from_bundle(app: &AppHandle) -> Option<Vec<u8>> {
    let dir = app.path().resource_dir().ok()?;
    let candidates = [
        dir.join("icons").join("plugin.png"),
        dir.join("Resources").join("icons").join("plugin.png"),
        PathBuf::from("icons/plugin.png"),
    ];
    for path in candidates {
        if let Ok(bytes) = std::fs::read(&path) {
            if validate_png(&bytes).is_ok() {
                return Some(bytes);
            }
        }
    }
    None
}

fn png_for_kind(
    app: &AppHandle,
    kind: &DesktopIconKind,
    png: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    match kind {
        DesktopIconKind::Default => Ok(DEFAULT_ICON_PNG.to_vec()),
        DesktopIconKind::Plugin => {
            if let Some(bytes) = png {
                validate_png(bytes)?;
                return Ok(bytes.to_vec());
            }
            plugin_png_from_bundle(app).ok_or_else(|| "Plugin icon PNG is required".to_string())
        }
    }
}

fn apply_window_icons(app: &AppHandle, png: &[u8]) -> Result<(), String> {
    validate_png(png)?;
    let image = Image::from_bytes(png).map_err(|e| e.to_string())?;
    for (_, window) in app.webview_windows() {
        let _ = window.set_icon(image.clone());
    }
    Ok(())
}

/// macOS has no window icon; `Window::set_icon` does not move the Dock tile.
/// `setApplicationIconImage` overlays a custom image. Passing `nil` restores
/// the bundled `CFBundleIconFile` — that is the default reset, and it only
/// works if the bundle `.icns` is the bottle, not BI.
#[cfg(target_os = "macos")]
fn set_macos_dock_icon(png: &[u8]) -> Result<(), String> {
    use cocoa::appkit::NSImage;
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSData;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let app: id = msg_send![class!(NSApplication), sharedApplication];
        let data = NSData::dataWithBytes_length_(
            nil,
            png.as_ptr() as *const std::os::raw::c_void,
            png.len() as u64,
        );
        let icon = NSImage::initWithData_(NSImage::alloc(nil), data);
        if icon == nil {
            return Err("Failed to decode PNG for Dock icon".into());
        }
        let _: () = msg_send![app, setApplicationIconImage: icon];
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn reset_macos_dock_to_bundle() -> Result<(), String> {
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let app: id = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, setApplicationIconImage: nil];
    }
    Ok(())
}

fn apply_kind(app: &AppHandle, kind: &DesktopIconKind, png: &[u8]) -> Result<(), String> {
    apply_window_icons(app, png)?;
    #[cfg(target_os = "macos")]
    match kind {
        DesktopIconKind::Default => reset_macos_dock_to_bundle()?,
        DesktopIconKind::Plugin => set_macos_dock_icon(png)?,
    }
    Ok(())
}

fn log_icon(app: &AppHandle, kind: &DesktopIconKind, bytes: usize) {
    if let Some(state) = app.try_state::<crate::AppState>() {
        state
            .log
            .write_line("shell:icon", &format!("kind={kind:?} bytes={bytes}"));
    }
}

/// Apply the DevHub bottle or a plugin PNG to the running shell.
///
/// `png` is ignored for `default` — the bottle is compiled in, and the Dock
/// tile is restored from the bundle `.icns`. Plugin bytes come from the
/// dashboard or `icons/plugin.png` in the bundle.
#[tauri::command]
pub fn set_desktop_icon(
    app: AppHandle,
    kind: DesktopIconKind,
    png: Option<Vec<u8>>,
) -> Result<(), String> {
    let bytes = png_for_kind(&app, &kind, png.as_deref())?;
    log_icon(&app, &kind, bytes.len());
    apply_kind(&app, &kind, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_icon_is_a_png() {
        assert!(validate_png(DEFAULT_ICON_PNG).is_ok());
    }

    #[test]
    fn rejects_non_png() {
        assert!(validate_png(b"not a png").is_err());
        assert!(validate_png(&[]).is_err());
    }
}
