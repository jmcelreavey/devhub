//! Update orchestration.
//!
//! Rust owns this and exposes narrow commands. The dashboard gets to *ask* and
//! to *render*; it does not get to hand the shell a URL to install from. That
//! separation matters because the dashboard is a remote origin, and "install
//! this binary" is the single most dangerous thing a web page could ask for.
//!
//! Signatures are non-negotiable and enforced by the plugin, not by us: Tauri
//! verifies against the public key compiled into the binary and refuses
//! anything that does not match. Install fails closed. There is no
//! "install anyway", because an update channel without signature verification
//! is a remote code execution channel with extra steps.
//!
//! The Electron launcher shipped a cache-scanning manual replacement workaround
//! for its own broken updater. Nothing like it exists here and nothing like it
//! should be added: it bypassed every check that makes an update safe.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum UpdateProgress {
    /// Total is `None` when the server sent no content-length. The UI shows an
    /// honest indeterminate bar rather than inventing a percentage.
    Started {
        total: Option<u64>,
    },
    Downloading {
        downloaded: u64,
        total: Option<u64>,
    },
    Installing,
    Done,
    Failed {
        error: String,
    },
}

/// The installed version. Read from the binary, so it cannot drift from what
/// the updater compares against.
#[tauri::command]
pub fn current_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Check without installing.
///
/// Errors are returned rather than surfaced as "no update": a user who is
/// offline should be told the check failed, not quietly assured they are up to
/// date. Those are different facts and only one of them is reassuring.
/// Build an updater, honouring a test-only endpoint override.
///
/// `DEVHUB_UPDATE_ENDPOINT` exists so the N→N+1 update can actually be
/// rehearsed against a local server before a release strands anybody. Without
/// it the first real update is also the first *tested* update, which for a
/// mechanism whose failure mode is "nobody can ever update again" is not a
/// reasonable place to find out.
///
/// This is safe to ship, and it is worth being explicit about why: the endpoint
/// is not the security boundary — **the signature is**. An attacker who can set
/// environment variables for this process can already replace the binary
/// outright, and even then they cannot produce an update this app will install,
/// because it verifies against a public key compiled into it. Redirecting the
/// endpoint just gets you a download that fails verification.
fn updater_for(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder();

    if let Ok(endpoint) = std::env::var("DEVHUB_UPDATE_ENDPOINT") {
        let url = endpoint
            .parse()
            .map_err(|e| format!("Bad DEVHUB_UPDATE_ENDPOINT: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
        if let Some(state) = app.try_state::<crate::AppState>() {
            state
                .log
                .write_line("updater", &format!("using test endpoint {endpoint}"));
        }
    }

    builder.build().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let updater = updater_for(&app)?;

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            current_version: current,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            current_version: current,
            version: None,
            notes: None,
            date: None,
        }),
        Err(err) => Err(err.to_string()),
    }
}

/// Download and install, emitting progress.
///
/// Deliberately does not relaunch. Restarting the app out from under someone
/// mid-sentence is hostile; the UI offers "Restart now" and the user decides.
/// A failed install leaves the running version completely untouched — Tauri
/// stages the replacement and only swaps on success.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = updater_for(&app)?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    let mut total: Option<u64> = None;

    let result = update
        .download_and_install(
            |chunk, content_length| {
                if total.is_none() {
                    total = content_length;
                    let _ = progress_app.emit(
                        "devhub://update-progress",
                        UpdateProgress::Started { total },
                    );
                }
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "devhub://update-progress",
                    UpdateProgress::Downloading { downloaded, total },
                );
            },
            || {
                let _ = progress_app.emit("devhub://update-progress", UpdateProgress::Installing);
            },
        )
        .await;

    match result {
        Ok(()) => {
            let _ = app.emit("devhub://update-progress", UpdateProgress::Done);
            Ok(())
        }
        Err(err) => {
            let message = err.to_string();
            let _ = app.emit(
                "devhub://update-progress",
                UpdateProgress::Failed {
                    error: message.clone(),
                },
            );
            Err(message)
        }
    }
}

/// Restart into the installed version, when the user says so.
#[tauri::command]
pub fn relaunch(app: AppHandle) {
    app.restart()
}

/// Check once, in the background, after the app is already usable.
///
/// Never blocks startup and never opens a modal. An update dialog in front of
/// someone who just wanted to open their notes is an interruption dressed up as
/// diligence; the banner can wait until they look at it. A failed check is
/// logged and dropped — being offline is not an error worth a notification.
pub fn check_in_background(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // A beat after ready, so the check competes with nothing the user can see.
        tokio_sleep(std::time::Duration::from_secs(5)).await;
        match check_update(handle.clone()).await {
            Ok(info) if info.available => {
                let _ = handle.emit("devhub://update-available", info);
            }
            Ok(_) => {}
            Err(err) => {
                if let Some(state) = handle.try_state::<crate::AppState>() {
                    state
                        .log
                        .write_line("updater", &format!("check failed: {err}"));
                }
            }
        }
    });
}

async fn tokio_sleep(duration: std::time::Duration) {
    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration))
        .await
        .ok();
}

use tauri::Manager;

/// Headless check-download-install, for the canary rehearsal.
///
/// Exercises exactly the same code path as the banner's Download button —
/// same builder, same signature verification, same install — with no window
/// and no user. That equivalence is the point: a canary that used a different
/// path would prove the canary works.
///
/// It deliberately does not relaunch. The caller checks the installed version
/// on disk afterwards, which is a stronger assertion than the app reporting
/// its own success.
pub async fn run_canary(app: AppHandle) -> i32 {
    println!("current version: {}", app.package_info().version);

    let info = match check_update(app.clone()).await {
        Ok(i) => i,
        Err(err) => {
            eprintln!("FAIL  update check: {err}");
            return 1;
        }
    };

    if !info.available {
        eprintln!("FAIL  no update offered — check the manifest version is higher");
        return 1;
    }
    println!(
        "PASS  update offered: {}",
        info.version.clone().unwrap_or_default()
    );

    match install_update(app.clone()).await {
        Ok(()) => {
            println!("PASS  downloaded, signature verified, installed");
            0
        }
        Err(err) => {
            // The most valuable failure this can report. A signature mismatch
            // here is the difference between finding out now and finding out
            // when nobody can update any more.
            eprintln!("FAIL  install: {err}");
            1
        }
    }
}
