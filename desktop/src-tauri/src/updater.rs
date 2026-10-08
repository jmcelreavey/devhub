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

/// Why a check failed, in the terms a person can act on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckFailure {
    /// The endpoint answered, but with no release manifest: a 404 or an empty
    /// body. Until a release is published, that is what every install sees.
    NoRelease,
    /// The server could not be reached (offline, DNS, timeout, TLS).
    Unreachable(String),
    /// Anything else, kept verbatim for the Details view.
    Other(String),
}

impl CheckFailure {
    pub fn from_error(err: &tauri_plugin_updater::Error) -> Self {
        use tauri_plugin_updater::Error;
        match err {
            // `Updater::check` returns this when no endpoint produced a release:
            // a non-success status such as 404 never becomes `last_error`.
            Error::ReleaseNotFound => CheckFailure::NoRelease,
            Error::Reqwest(inner)
                if inner.is_connect() || inner.is_timeout() || inner.is_request() =>
            {
                CheckFailure::Unreachable(err.to_string())
            }
            other => CheckFailure::Other(other.to_string()),
        }
    }
}

/// Everything a manual "Check for updates" can end in. Never an error value, so
/// the caller always has something to show.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CheckOutcome {
    #[serde(rename_all = "camelCase")]
    UpToDate { current_version: String },
    #[serde(rename_all = "camelCase")]
    Available {
        current_version: String,
        version: String,
        notes: Option<String>,
        date: Option<String>,
    },
    /// No release has been published yet. Not an error: there is nothing newer.
    #[serde(rename_all = "camelCase")]
    NoRelease { current_version: String },
    #[serde(rename_all = "camelCase")]
    Failed {
        current_version: String,
        message: String,
        details: String,
    },
}

pub fn outcome_for(
    current: &str,
    result: Result<Option<UpdateInfo>, CheckFailure>,
) -> CheckOutcome {
    let current_version = current.to_string();
    match result {
        Ok(Some(info)) if info.available => CheckOutcome::Available {
            current_version,
            version: info.version.unwrap_or_default(),
            notes: info.notes,
            date: info.date,
        },
        Ok(_) => CheckOutcome::UpToDate { current_version },
        Err(CheckFailure::NoRelease) => CheckOutcome::NoRelease { current_version },
        Err(CheckFailure::Unreachable(details)) => CheckOutcome::Failed {
            current_version,
            message: "Couldn't reach the update server. Check your connection and try again."
                .into(),
            details,
        },
        Err(CheckFailure::Other(details)) => CheckOutcome::Failed {
            current_version,
            message: "The update check failed.".into(),
            details,
        },
    }
}

/// One line for the shell log and for the native fallback dialog.
pub fn describe_outcome(outcome: &CheckOutcome) -> String {
    match outcome {
        CheckOutcome::UpToDate { current_version } => {
            format!("You're up to date ({current_version}).")
        }
        CheckOutcome::Available {
            current_version,
            version,
            ..
        } => format!("DevHub {version} is available. You're on {current_version}."),
        CheckOutcome::NoRelease { current_version } => format!(
            "No published release yet. You're on {current_version}, the latest build there is."
        ),
        CheckOutcome::Failed {
            message, details, ..
        } => format!("{message} ({details})"),
    }
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

/// The check itself, without the "manual check" log line. The menu and the
/// background loop both use this so a missing release is classified the same way.
async fn check_outcome(app: &AppHandle) -> CheckOutcome {
    let current = app.package_info().version.to_string();
    let result = match updater_for(app) {
        Err(message) => Err(CheckFailure::Other(message)),
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => Ok(Some(UpdateInfo {
                available: true,
                current_version: current.clone(),
                version: Some(update.version.clone()),
                notes: update.body.clone(),
                date: update.date.map(|d| d.to_string()),
            })),
            Ok(None) => Ok(None),
            Err(err) => Err(CheckFailure::from_error(&err)),
        },
    };
    outcome_for(&current, result)
}

/// What the background loop writes. A repo with no published release is not a
/// failed check; everything else that is not an update stays quiet or says it failed.
pub fn background_check_log(outcome: &CheckOutcome) -> Option<String> {
    match outcome {
        CheckOutcome::Available { .. } | CheckOutcome::UpToDate { .. } => None,
        CheckOutcome::NoRelease { .. } => Some(describe_outcome(outcome)),
        CheckOutcome::Failed { .. } => Some(format!("check failed: {}", describe_outcome(outcome))),
    }
}

/// The manual check: always answers. `check_update` stays for the canary, which
/// wants the raw error.
///
/// Signature verification is untouched: this only reads the manifest.
#[tauri::command]
pub async fn check_update_outcome(app: AppHandle) -> CheckOutcome {
    let outcome = check_outcome(&app).await;
    if let Some(state) = app.try_state::<crate::AppState>() {
        state.log.write_line(
            "updater",
            &format!("manual check: {}", describe_outcome(&outcome)),
        );
    }
    outcome
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

/// How often a running shell re-checks. DevHub is meant to stay up for days —
/// closing the window only hides it — so a launch-only check left a long-lived
/// instance on an old version until someone happened to quit it.
const RECHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

static BACKGROUND_CHECKS_STARTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Check in the background once the app is usable, then every few hours.
///
/// Never blocks startup and never opens a modal. An update dialog in front of
/// someone who just wanted to open their notes is an interruption dressed up as
/// diligence; the banner can wait until they look at it. A failed check is
/// logged and dropped — being offline is not an error worth a notification.
///
/// Called on every healthy start, and a retried start in the same process
/// reaches it again, so only the first call starts the loop.
pub fn check_in_background(app: &AppHandle) {
    if BACKGROUND_CHECKS_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        // A beat after ready, so the check competes with nothing the user can see.
        std::thread::sleep(std::time::Duration::from_secs(5));
        let mut announced: Option<String> = None;
        loop {
            match tauri::async_runtime::block_on(check_outcome(&handle)) {
                CheckOutcome::Available {
                    current_version,
                    version,
                    notes,
                    date,
                } => {
                    // Once per version: re-announcing the same one every few
                    // hours would keep reopening a banner the user dismissed.
                    if announced.as_ref() != Some(&version) {
                        announced = Some(version.clone());
                        let _ = handle.emit(
                            "devhub://update-available",
                            UpdateInfo {
                                available: true,
                                current_version,
                                version: Some(version),
                                notes,
                                date,
                            },
                        );
                    }
                }
                other => {
                    if let Some(line) = background_check_log(&other) {
                        if let Some(state) = handle.try_state::<crate::AppState>() {
                            state.log.write_line("updater", &line);
                        }
                    }
                }
            }
            std::thread::sleep(RECHECK_INTERVAL);
        }
    });
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

#[cfg(test)]
mod tests {
    use super::*;

    fn info(version: &str) -> UpdateInfo {
        UpdateInfo {
            available: true,
            current_version: "2.0.0".into(),
            version: Some(version.into()),
            notes: Some("notes".into()),
            date: None,
        }
    }

    #[test]
    fn up_to_date_says_so_with_the_version() {
        let outcome = outcome_for("2.0.0", Ok(None));
        assert_eq!(
            outcome,
            CheckOutcome::UpToDate {
                current_version: "2.0.0".into()
            }
        );
        assert_eq!(describe_outcome(&outcome), "You're up to date (2.0.0).");
    }

    #[test]
    fn an_available_update_carries_its_version_and_notes() {
        let outcome = outcome_for("2.0.0", Ok(Some(info("2.1.0"))));
        assert_eq!(
            outcome,
            CheckOutcome::Available {
                current_version: "2.0.0".into(),
                version: "2.1.0".into(),
                notes: Some("notes".into()),
                date: None
            }
        );
        assert!(describe_outcome(&outcome).contains("2.1.0 is available"));
    }

    #[test]
    fn a_missing_release_is_not_an_error() {
        // 404 / nothing published: the plugin returns ReleaseNotFound.
        let failure = CheckFailure::from_error(&tauri_plugin_updater::Error::ReleaseNotFound);
        assert_eq!(failure, CheckFailure::NoRelease);
        let outcome = outcome_for("2.0.0", Err(failure));
        assert!(matches!(outcome, CheckOutcome::NoRelease { .. }));
        assert!(describe_outcome(&outcome).starts_with("No published release yet."));
        let line = background_check_log(&outcome).expect("a missing release is logged");
        assert!(line.starts_with("No published release yet."));
        assert!(!line.contains("check failed"));
        assert!(background_check_log(&outcome_for("2.0.0", Ok(None))).is_none());
    }

    #[test]
    fn an_unreachable_server_is_a_readable_failure_with_details() {
        let outcome = outcome_for(
            "2.0.0",
            Err(CheckFailure::Unreachable("dns error: no such host".into())),
        );
        let CheckOutcome::Failed {
            message, details, ..
        } = outcome
        else {
            panic!("expected a failure");
        };
        assert!(message.contains("Couldn't reach the update server"));
        assert_eq!(details, "dns error: no such host");
    }

    #[test]
    fn any_other_failure_keeps_the_raw_text_for_details() {
        let failure = CheckFailure::from_error(&tauri_plugin_updater::Error::Network(
            "Download request failed with status: 500".into(),
        ));
        assert!(matches!(&failure, CheckFailure::Other(text) if text.contains("500")));
        let CheckOutcome::Failed {
            message, details, ..
        } = outcome_for("2.0.0", Err(failure))
        else {
            panic!("expected a failure");
        };
        assert_eq!(message, "The update check failed.");
        assert!(details.contains("500"));
    }

    #[test]
    fn outcomes_serialise_with_a_status_tag_the_banner_switches_on() {
        let json = serde_json::to_value(outcome_for("2.0.0", Ok(None))).unwrap();
        assert_eq!(json["status"], "upToDate");
        assert_eq!(json["currentVersion"], "2.0.0");
        let json =
            serde_json::to_value(outcome_for("2.0.0", Err(CheckFailure::NoRelease))).unwrap();
        assert_eq!(json["status"], "noRelease");
    }
}
