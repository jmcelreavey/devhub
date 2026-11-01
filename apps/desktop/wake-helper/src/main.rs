//! Root LaunchDaemon that schedules Mac wakes for DevHub's scheduled jobs.
//!
//! Scheduling a wake (`IOPMSchedulePowerEvent`, what `pmset schedule` wraps)
//! needs root; the dashboard is an ordinary user process. This daemon is the
//! whole privileged surface: three one-line commands over a local socket, and
//! it can only schedule, cancel or report DevHub's *own* wake event.
//!
//! The socket is world-writable rather than checking peer credentials. The
//! worst a hostile local process can do with it is wake the Mac at a time of
//! its choosing, which is not worth an access-control layer running as root.
//!
//! Protocol (one request per connection):
//!   `schedule <unix-seconds>` → `ok <version> <unix-seconds>`
//!   `cancel`                  → `ok <version> -`
//!   `status`                  → `ok <version> <earliest unix-seconds | ->`
//!   anything wrong            → `err <message>`

use std::ffi::{c_char, c_void, CString};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::ptr::null;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const SOCKET_PATH: &str = "/var/run/com.devhub.wake-helper.sock";
/// Shown as the owner in `pmset -g sched`; also how we find our own events.
const OWNER_ID: &str = "com.devhub.wake-helper";
/// Wake from sleep, or power on if the Mac is off.
const EVENT_TYPE: &str = "wakepoweron";
const MIN_AHEAD_SECS: i64 = 5;
const MAX_AHEAD_SECS: i64 = 35 * 24 * 3600;
/// CFAbsoluteTime counts from 2001-01-01; Unix time from 1970-01-01.
const CF_EPOCH_OFFSET: f64 = 978_307_200.0;
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

type CFTypeRef = *const c_void;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(alloc: CFTypeRef, c_str: *const c_char, encoding: u32) -> CFTypeRef;
    fn CFDateCreate(alloc: CFTypeRef, at: f64) -> CFTypeRef;
    fn CFDateGetAbsoluteTime(date: CFTypeRef) -> f64;
    fn CFArrayGetCount(array: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFEqual(a: CFTypeRef, b: CFTypeRef) -> u8;
    fn CFRelease(cf: CFTypeRef);
}

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPMSchedulePowerEvent(time: CFTypeRef, owner: CFTypeRef, kind: CFTypeRef) -> i32;
    fn IOPMCancelScheduledPowerEvent(time: CFTypeRef, owner: CFTypeRef, kind: CFTypeRef) -> i32;
    fn IOPMCopyScheduledPowerEvents() -> CFTypeRef;
}

extern "C" {
    fn geteuid() -> u32;
}

/// An owned CoreFoundation reference, released on drop.
struct Cf(CFTypeRef);

impl Drop for Cf {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}

fn cf_string(s: &str) -> Cf {
    let c = CString::new(s).expect("constant strings have no NUL");
    Cf(unsafe { CFStringCreateWithCString(null(), c.as_ptr(), CF_STRING_ENCODING_UTF8) })
}

#[derive(Debug, PartialEq)]
enum Command {
    Schedule(i64),
    Cancel,
    Status,
}

fn parse_command(line: &str) -> Result<Command, String> {
    let mut parts = line.split_whitespace();
    match (parts.next(), parts.next(), parts.next()) {
        (Some("schedule"), Some(at), None) => at
            .parse::<i64>()
            .map(Command::Schedule)
            .map_err(|_| "schedule needs unix seconds".to_string()),
        (Some("cancel"), None, None) => Ok(Command::Cancel),
        (Some("status"), None, None) => Ok(Command::Status),
        _ => Err("unknown command".to_string()),
    }
}

fn validate_wake(at: i64, now: i64) -> Result<(), String> {
    if at < now + MIN_AHEAD_SECS {
        return Err("wake time must be in the future".to_string());
    }
    if at > now + MAX_AHEAD_SECS {
        return Err("wake time is more than 35 days away".to_string());
    }
    Ok(())
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// `YYYY-MM-DDTHH:MM:SSZ` without a date crate (days-to-civil, Howard Hinnant).
fn utc_timestamp(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

/// launchd sends stderr to /var/log/com.devhub.wake-helper.log.
fn log(message: &str) {
    eprintln!("{} {message}", utc_timestamp(unix_now()));
}

/// Visit every scheduled power event this helper owns: (date, type, unix secs).
/// The references are borrowed from a copied array that outlives the callback.
fn for_each_own_event(mut visit: impl FnMut(CFTypeRef, CFTypeRef, i64)) {
    unsafe {
        let events = Cf(IOPMCopyScheduledPowerEvents());
        if events.0.is_null() {
            return;
        }
        let owner = cf_string(OWNER_ID);
        let key_owner = cf_string("scheduledby");
        let key_time = cf_string("time");
        let key_type = cf_string("eventtype");
        for i in 0..CFArrayGetCount(events.0) {
            let event = CFArrayGetValueAtIndex(events.0, i);
            let by = CFDictionaryGetValue(event, key_owner.0);
            if by.is_null() || CFEqual(by, owner.0) == 0 {
                continue;
            }
            let time = CFDictionaryGetValue(event, key_time.0);
            let kind = CFDictionaryGetValue(event, key_type.0);
            if time.is_null() || kind.is_null() {
                continue;
            }
            let unix = (CFDateGetAbsoluteTime(time) + CF_EPOCH_OFFSET).round() as i64;
            visit(time, kind, unix);
        }
    }
}

fn cancel_own_events() -> usize {
    let owner = cf_string(OWNER_ID);
    let mut cancelled = 0;
    for_each_own_event(|time, kind, _| {
        if unsafe { IOPMCancelScheduledPowerEvent(time, owner.0, kind) } == 0 {
            cancelled += 1;
        }
    });
    cancelled
}

fn earliest_own_event() -> Option<i64> {
    let mut earliest: Option<i64> = None;
    for_each_own_event(|_, _, unix| {
        earliest = Some(earliest.map_or(unix, |e| e.min(unix)));
    });
    earliest
}

/// Only ever one DevHub wake: the scheduler always asks for its next job.
fn schedule_wake(at: i64) -> Result<usize, String> {
    validate_wake(at, unix_now())?;
    let replaced = cancel_own_events();
    let owner = cf_string(OWNER_ID);
    let kind = cf_string(EVENT_TYPE);
    let date = Cf(unsafe { CFDateCreate(null(), at as f64 - CF_EPOCH_OFFSET) });
    let code = unsafe { IOPMSchedulePowerEvent(date.0, owner.0, kind.0) };
    if code != 0 {
        return Err(format!("IOPMSchedulePowerEvent failed (0x{code:x})"));
    }
    Ok(replaced)
}

fn respond(command: Result<Command, String>) -> String {
    // Status is a read the dashboard polls; only changes and refusals are logged.
    let result = command.and_then(|c| match c {
        Command::Schedule(at) => schedule_wake(at).map(|replaced| {
            log(&format!("scheduled wake for {} (replaced {replaced} earlier DevHub wake(s))", utc_timestamp(at)));
            at.to_string()
        }),
        Command::Cancel => {
            let cancelled = cancel_own_events();
            log(&format!("cancelled {cancelled} DevHub wake(s)"));
            Ok("-".to_string())
        }
        Command::Status => Ok(earliest_own_event().map_or("-".to_string(), |t| t.to_string())),
    });
    match result {
        Ok(value) => format!("ok {VERSION} {value}\n"),
        Err(message) => {
            log(&format!("refused request: {message}"));
            format!("err {message}\n")
        }
    }
}

fn handle(stream: UnixStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut line = String::new();
    // Bounded read: a request is a few dozen bytes.
    let mut reader = BufReader::new((&stream).take(256));
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let reply = respond(parse_command(line.trim()));
    let _ = (&stream).write_all(reply.as_bytes());
}

fn main() {
    if unsafe { geteuid() } != 0 {
        log("com.devhub.wake-helper must run as root (it is a LaunchDaemon)");
        std::process::exit(1);
    }
    // /var/run is root-owned, so nothing else can have planted this path.
    let _ = std::fs::remove_file(SOCKET_PATH);
    let listener = match UnixListener::bind(SOCKET_PATH) {
        Ok(listener) => listener,
        Err(err) => {
            log(&format!("could not bind {SOCKET_PATH}: {err}"));
            std::process::exit(1);
        }
    };
    if let Err(err) = std::fs::set_permissions(SOCKET_PATH, std::fs::Permissions::from_mode(0o666)) {
        log(&format!("could not open {SOCKET_PATH} to the dashboard: {err}"));
        std::process::exit(1);
    }
    let pending = earliest_own_event().map_or("none".to_string(), utc_timestamp);
    log(&format!("started v{VERSION}, listening on {SOCKET_PATH}; pending DevHub wake: {pending}"));
    // Sequential on purpose: requests are rare and each is a syscall or two.
    for stream in listener.incoming().flatten() {
        handle(stream);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_three_commands() {
        assert_eq!(parse_command("schedule 1700000000"), Ok(Command::Schedule(1_700_000_000)));
        assert_eq!(parse_command("cancel"), Ok(Command::Cancel));
        assert_eq!(parse_command("status"), Ok(Command::Status));
    }

    #[test]
    fn rejects_anything_else() {
        assert!(parse_command("").is_err());
        assert!(parse_command("schedule").is_err());
        assert!(parse_command("schedule soon").is_err());
        assert!(parse_command("schedule 1 2").is_err());
        assert!(parse_command("status now").is_err());
        assert!(parse_command("rm -rf /").is_err());
    }

    #[test]
    fn wake_must_be_near_future() {
        let now = 1_700_000_000;
        assert!(validate_wake(now, now).is_err());
        assert!(validate_wake(now + 4, now).is_err());
        assert!(validate_wake(now + 60, now).is_ok());
        assert!(validate_wake(now + MAX_AHEAD_SECS, now).is_ok());
        assert!(validate_wake(now + MAX_AHEAD_SECS + 1, now).is_err());
    }

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(utc_timestamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_timestamp(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc_timestamp(1_789_409_880), "2026-09-14T18:18:00Z");
    }
}
