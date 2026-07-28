//! Bounded, rotating logs for the sidecar and shell.
//!
//! Two properties matter more than features here.
//!
//! **Bounded.** The sidecar inherits a Next server that logs every request. An
//! unbounded log file on a long-running desktop app is a disk-space bug that
//! shows up months later on somebody else's machine.
//!
//! **Present when startup fails.** The failure UI shows the last lines of this
//! file. A logger that only works once the app is healthy is a logger that is
//! absent exactly when it is needed, so writes are line-buffered to disk rather
//! than held in memory.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use tauri::{AppHandle, Emitter};

/// Rotate at 2 MiB, keep one previous file. Enough to diagnose a failed start,
/// small enough that nobody notices it.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone)]
struct LogFile {
    path: PathBuf,
    file: Arc<Mutex<Option<File>>>,
}

#[derive(Clone)]
pub struct DesktopLog {
    shell: LogFile,
    sidecar: LogFile,
    renderer: LogFile,
    /// Optional live feed for the boot screen / in-app viewer. Absent until the
    /// app handle exists — writing before that still hits the file.
    emitter: Arc<Mutex<Option<AppHandle>>>,
    /// When this launch started, so `tail` can ignore previous ones.
    ///
    /// The files are append-only across launches, so an unfiltered tail hands
    /// the boot screen half an hour of someone else's startup and presents it
    /// as the current one. Watching a relaunch replay the log of the run you
    /// just quit is worse than an empty panel: it looks like progress.
    opened_at_ms: u128,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// The `unix_ms` a `write_line` stamp carries, if this is one of our lines.
fn line_timestamp(line: &str) -> Option<u128> {
    line.strip_prefix("[unix_ms=")?
        .split_once(']')?
        .0
        .parse()
        .ok()
}

impl DesktopLog {
    pub fn open(log_dir: &Path) -> Self {
        let _ = fs::create_dir_all(log_dir);
        let open_file = |name: &str| {
            let path = log_dir.join(name);
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .ok();
            LogFile {
                path,
                file: Arc::new(Mutex::new(file)),
            }
        };
        Self {
            shell: open_file("shell.log"),
            sidecar: open_file("sidecar.log"),
            renderer: open_file("renderer.log"),
            emitter: Arc::new(Mutex::new(None)),
            opened_at_ms: now_ms(),
        }
    }

    /// Wire the live event feed once the app handle exists.
    pub fn attach_emitter(&self, app: AppHandle) {
        if let Ok(mut guard) = self.emitter.lock() {
            *guard = Some(app);
        }
    }

    /// The shell log remains the primary log for callers which can expose one
    /// path, while the log directory contains the sidecar's noisier transcript.
    pub fn path(&self) -> &Path {
        &self.shell.path
    }

    pub fn write_line(&self, source: &str, line: &str) {
        let target = if source.starts_with("sidecar") {
            &self.sidecar
        } else if source.starts_with("renderer") {
            &self.renderer
        } else {
            &self.shell
        };
        let timestamp_ms = now_ms();
        let stamped = format!("[unix_ms={timestamp_ms}][{source}] {}\n", line.trim_end());
        let mut guard = match target.file.lock() {
            Ok(g) => g,
            // A poisoned mutex means another thread panicked mid-write. Losing
            // a log line is strictly better than panicking the logger and
            // taking the shell down with it.
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(file) = guard.as_mut() {
            let _ = file.write_all(stamped.as_bytes());
            let _ = file.flush();
            if file.stream_position().unwrap_or(0) > MAX_BYTES {
                drop(guard);
                Self::rotate(target);
            }
        }
        // Live feed for anyone watching the boot screen. Failures here must
        // never take down logging itself.
        if let Ok(guard) = self.emitter.lock() {
            if let Some(app) = guard.as_ref() {
                let _ = app.emit("devhub://log", stamped.trim_end());
            }
        }
    }

    fn rotate(target: &LogFile) {
        let previous = target.path.with_extension("log.1");
        let _ = fs::rename(&target.path, &previous);
        let reopened = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target.path)
            .ok();
        if let Ok(mut guard) = target.file.lock() {
            *guard = reopened;
        }
    }

    /// The last `n` lines of *this* launch, for the boot screen and the
    /// startup-failure UI.
    ///
    /// Reads the files rather than keeping a ring buffer in memory, because the
    /// interesting failure is the one where the shell restarted and the
    /// in-memory buffer is empty. Lines from earlier launches are dropped: see
    /// `opened_at_ms`.
    pub fn tail(&self, n: usize) -> Vec<String> {
        let since_ms = self.opened_at_ms;
        let mut lines = Vec::new();
        for target in [&self.shell, &self.sidecar, &self.renderer] {
            let Ok(mut file) = File::open(&target.path) else {
                continue;
            };
            // Cap the read: a 2 MiB file scanned line by line to show 80 lines
            // is wasteful, and the tail is all anyone reads.
            let len = file.metadata().map(|m| m.len()).unwrap_or(0);
            let window = 256 * 1024;
            if len > window {
                let _ = file.seek(SeekFrom::Start(len - window));
            }
            lines.extend(
                BufReader::new(file)
                    .lines()
                    .map_while(Result::ok)
                    // An undated line is either a torn write or a fragment left
                    // by seeking into the middle of one. Either way it cannot be
                    // placed in this launch, so it is not shown as part of it.
                    .filter(|line| line_timestamp(line).is_some_and(|ms| ms >= since_ms)),
            );
        }
        // The stamp is a fixed-width prefix, so a plain sort is a chronological
        // sort — and it is what interleaves the shell and sidecar transcripts
        // back into the order things actually happened.
        lines.sort();
        if lines.len() > n {
            lines = lines.split_off(lines.len() - n);
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_returns_the_most_recent_lines() {
        let tmp = tempfile::tempdir().unwrap();
        let log = DesktopLog::open(tmp.path());
        for i in 0..100 {
            log.write_line("test", &format!("line {i}"));
        }
        let tail = log.tail(5);
        assert_eq!(tail.len(), 5);
        assert!(tail.last().unwrap().contains("line 99"));
        assert!(tail.first().unwrap().contains("line 95"));
    }

    #[test]
    fn tail_of_a_missing_file_is_empty_not_a_panic() {
        // The failure UI calls this before anything has necessarily written.
        let tmp = tempfile::tempdir().unwrap();
        let log = DesktopLog {
            shell: LogFile {
                path: tmp.path().join("nope-shell.log"),
                file: Arc::new(Mutex::new(None)),
            },
            sidecar: LogFile {
                path: tmp.path().join("nope-sidecar.log"),
                file: Arc::new(Mutex::new(None)),
            },
            renderer: LogFile {
                path: tmp.path().join("nope-renderer.log"),
                file: Arc::new(Mutex::new(None)),
            },
            emitter: Arc::new(Mutex::new(None)),
            opened_at_ms: 0,
        };
        assert!(log.tail(10).is_empty());
    }

    /// The boot screen's log panel gets the current startup, not a replay of
    /// the one the user just quit. Relaunches append to the same files, so an
    /// unfiltered tail is indistinguishable from live output.
    #[test]
    fn tail_ignores_lines_from_a_previous_launch() {
        let tmp = tempfile::tempdir().unwrap();
        let previous = DesktopLog::open(tmp.path());
        previous.write_line("shell", "from the last run");

        // A second `open` on the same directory is what a relaunch does.
        std::thread::sleep(std::time::Duration::from_millis(5));
        let current = DesktopLog::open(tmp.path());
        current.write_line("shell", "from this run");

        let tail = current.tail(80);
        assert!(
            tail.iter().any(|l| l.contains("from this run")),
            "this launch's lines must be present: {tail:?}"
        );
        assert!(
            !tail.iter().any(|l| l.contains("from the last run")),
            "a previous launch must not appear as current output: {tail:?}"
        );
    }

    /// Seeking into a large file lands mid-line. That fragment has no stamp, so
    /// it cannot be dated into this launch and must not be rendered as output.
    #[test]
    fn tail_drops_undated_fragments() {
        let tmp = tempfile::tempdir().unwrap();
        let log = DesktopLog::open(tmp.path());
        log.write_line("shell", "properly stamped");
        {
            let mut guard = log.shell.file.lock().unwrap();
            let file = guard.as_mut().unwrap();
            file.write_all(b"torn fragment with no stamp\n").unwrap();
        }

        let tail = log.tail(80);
        assert!(tail.iter().any(|l| l.contains("properly stamped")));
        assert!(!tail.iter().any(|l| l.contains("torn fragment")));
    }

    #[test]
    fn line_timestamps_parse_only_from_our_own_stamps() {
        assert_eq!(line_timestamp("[unix_ms=42][shell] hello"), Some(42));
        assert_eq!(line_timestamp("no stamp here"), None);
        assert_eq!(line_timestamp("[unix_ms=notanumber][shell] x"), None);
        assert_eq!(line_timestamp("[unix_ms=42 unterminated"), None);
    }

    #[test]
    fn rotation_keeps_the_live_file_small() {
        let tmp = tempfile::tempdir().unwrap();
        let log = DesktopLog::open(tmp.path());
        let chunk = "x".repeat(4096);
        for _ in 0..700 {
            log.write_line("test", &chunk);
        }
        let live = fs::metadata(log.path()).unwrap().len();
        assert!(
            live <= MAX_BYTES + (chunk.len() as u64 * 2),
            "live log grew to {live} bytes without rotating"
        );
        assert!(
            log.path().with_extension("log.1").exists(),
            "expected a rotated file"
        );
    }

    #[test]
    fn sidecar_output_gets_its_own_log() {
        let tmp = tempfile::tempdir().unwrap();
        let log = DesktopLog::open(tmp.path());
        log.write_line("shell", "shell event");
        log.write_line("sidecar:stderr", "server event");

        assert!(fs::read_to_string(tmp.path().join("shell.log"))
            .unwrap()
            .contains("[unix_ms="));
        assert!(fs::read_to_string(tmp.path().join("sidecar.log"))
            .unwrap()
            .contains("server event"));
        log.write_line("renderer:bridge:open", "browser event");
        assert!(fs::read_to_string(tmp.path().join("renderer.log"))
            .unwrap()
            .contains("browser event"));
    }
}
