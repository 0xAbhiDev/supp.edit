//! A small append-only lifecycle log (`%APPDATA%\studio.supp.edit\lifecycle.log`): one line per
//! stage, flushed immediately, so an unexpected exit or crash leaves the last stage reached on
//! disk. Stages come from the host (launch, window, open, save, exit, panic) and from the page
//! (project restored, timeline hydrated, renderer and audio ready) through `lifecycle_mark`.
use std::{
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

static FILE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<PathBuf>> {
    FILE.get_or_init(|| Mutex::new(None))
}

/// Where the log lives (set once the app data directory is known); rotated past 1 MB.
pub fn init(dir: PathBuf) {
    let path = dir.join("lifecycle.log");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > 1024 * 1024) {
        let _ = std::fs::rename(&path, dir.join("lifecycle.1.log"));
    }
    if let Ok(mut s) = slot().lock() {
        *s = Some(path);
    }
}

pub fn mark(stage: &str, detail: &str) {
    let Ok(guard) = slot().lock() else { return };
    let Some(path) = guard.as_ref() else { return };
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let clean = |s: &str| s.replace(['\n', '\r', '\t'], " ").chars().take(400).collect::<String>();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{ms}\t{}\t{}\t{}", std::process::id(), clean(stage), clean(detail));
        let _ = f.flush();
    }
}

/// Panics are written to the lifecycle log before the default report.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        mark("panic", &format!("{message} at {at}"));
        previous(info);
    }));
}

/// The page reports its own stages (bounded, plain text).
#[tauri::command]
pub fn lifecycle_mark(stage: String, detail: Option<String>) {
    mark(&format!("page:{}", stage.chars().take(64).collect::<String>()), detail.as_deref().unwrap_or(""));
}
