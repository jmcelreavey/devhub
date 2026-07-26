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

/// Rotate at 2 MiB, keep one previous file. Enough to diagnose a failed start,
/// small enough that nobody notices it.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone)]
pub struct DesktopLog {
    path: PathBuf,
    file: Arc<Mutex<Option<File>>>,
}

impl DesktopLog {
    pub fn open(log_dir: &Path) -> Self {
        let _ = fs::create_dir_all(log_dir);
        let path = log_dir.join("desktop.log");
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok();
        Self {
            path,
            file: Arc::new(Mutex::new(file)),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn write_line(&self, source: &str, line: &str) {
        let stamped = format!("[{}] {}\n", source, line.trim_end());
        let mut guard = match self.file.lock() {
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
                self.rotate();
            }
        }
    }

    fn rotate(&self) {
        let previous = self.path.with_extension("log.1");
        let _ = fs::rename(&self.path, &previous);
        let reopened = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .ok();
        if let Ok(mut guard) = self.file.lock() {
            *guard = reopened;
        }
    }

    /// The last `n` lines, for the startup-failure UI.
    ///
    /// Reads the file rather than keeping a ring buffer in memory, because the
    /// interesting failure is the one where the shell restarted and the
    /// in-memory buffer is empty.
    pub fn tail(&self, n: usize) -> Vec<String> {
        let Ok(mut file) = File::open(&self.path) else {
            return Vec::new();
        };
        // Cap the read: a 2 MiB file scanned line by line to show 40 lines is
        // wasteful, and the tail is all anyone reads.
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let window = 64 * 1024;
        if len > window {
            let _ = file.seek(SeekFrom::Start(len - window));
        }
        let reader = BufReader::new(file);
        let mut lines: Vec<String> = reader.lines().map_while(Result::ok).collect();
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
            path: tmp.path().join("nope.log"),
            file: Arc::new(Mutex::new(None)),
        };
        assert!(log.tail(10).is_empty());
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
}
