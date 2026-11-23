//! Take choices as corrections. Each time a person replaces a recreated shot's source moment with
//! another take, the page records one JSON line in `%APPDATA%\studio.supp.edit\take-corrections.jsonl`:
//! which reference shot, the moment that was rejected and the one chosen. It stays on this computer
//! (nothing is sent anywhere); the evaluation scripts read it as labels for tuning selection
//! (`scripts/eval/corrections.mjs`). Rotated past 4 MB.
use std::{
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

static FILE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<PathBuf>> {
    FILE.get_or_init(|| Mutex::new(None))
}

pub fn init(dir: PathBuf) {
    let path = dir.join("take-corrections.jsonl");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > 4 * 1024 * 1024) {
        let _ = std::fs::rename(&path, dir.join("take-corrections.1.jsonl"));
    }
    if let Ok(mut s) = slot().lock() {
        *s = Some(path);
    }
}

/// Append one take choice (a JSON object of at most 16 KB).
#[tauri::command]
pub fn record_take_choice(entry: serde_json::Value) -> Result<(), String> {
    if !entry.is_object() {
        return Err("A take choice is a JSON object.".into());
    }
    let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    if line.len() > 16 * 1024 {
        return Err("A take choice is at most 16 KB.".into());
    }
    let guard = slot().lock().map_err(|_| "The corrections log is unavailable.".to_string())?;
    let path = guard.as_ref().ok_or("The corrections log is not set up yet.")?;
    let mut f = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    writeln!(f, "{line}").map_err(|e| e.to_string())?;
    f.flush().map_err(|e| e.to_string())
}

/// Every take choice recorded on this computer (the rotated file first, then the current one), as
/// JSON objects, the most recent 5,000 at most. Lines that do not parse are skipped.
#[tauri::command]
pub fn read_take_choices() -> Result<Vec<serde_json::Value>, String> {
    let guard = slot().lock().map_err(|_| "The corrections log is unavailable.".to_string())?;
    let Some(path) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for file in [path.with_file_name("take-corrections.1.jsonl"), path.clone()] {
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        out.extend(text.lines().filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()).filter(|v| v.is_object()));
    }
    let skip = out.len().saturating_sub(5000);
    Ok(out.into_iter().skip(skip).collect())
}
