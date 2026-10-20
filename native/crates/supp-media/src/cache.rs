//! Fingerprinted, bounded derived-media cache. Original sources are never cache eviction targets.
use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, File, FileTimes},
    hash::{Hash, Hasher},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
static ANALYSIS: Mutex<()> = Mutex::new(());
fn key(path: &Path) -> Result<String, String> {
    let path = crate::validate_path(path)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .hash(&mut hasher);
    Ok(format!("v2-{:016x}", hasher.finish()))
}
fn touch(path: &Path) {
    if let Ok(file) = File::options().write(true).open(path) {
        let _ = file.set_times(FileTimes::new().set_modified(SystemTime::now()));
    }
}
fn location(root: &Path, path: &Path, extension: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    Ok(root.join(format!("{}.{}", key(path)?, extension)))
}
fn prune(root: &Path, keep: &Path) -> Result<(), String> {
    let mut entries = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|e| {
            let p = e.path();
            let m = e.metadata().ok()?;
            if !m.is_file() || !e.file_name().to_string_lossy().starts_with("v2-") {
                return None;
            }
            Some((p, m.len(), m.modified().unwrap_or(UNIX_EPOCH)))
        })
        .collect::<Vec<_>>();
    let mut bytes = entries.iter().map(|e| e.1).sum::<u64>();
    let mut count = entries.len();
    entries.sort_by_key(|e| e.2);
    for (path, size, _) in entries {
        if bytes <= 256 * 1024 * 1024 && count <= 2000 {
            break;
        }
        if path != keep {
            fs::remove_file(path).map_err(|e| e.to_string())?;
            bytes -= size;
            count -= 1;
        }
    }
    Ok(())
}
pub fn thumbnail(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let _permit = ANALYSIS.lock().map_err(|e| e.to_string())?;
    let out = location(root, path, "jpg")?;
    if !out.exists() {
        crate::thumbnail(path, &out)?;
    }
    touch(&out);
    prune(root, &out)?;
    Ok(out)
}
pub fn waveform(root: &Path, path: &Path) -> Result<Vec<f32>, String> {
    let _permit = ANALYSIS.lock().map_err(|e| e.to_string())?;
    let out = location(root, path, "json")?;
    if let Ok(data) = fs::read(&out) {
        if let Ok(values) = serde_json::from_slice::<Vec<f32>>(&data) {
            if values.len() == 400 && values.iter().all(|v| v.is_finite()) {
                touch(&out);
                return Ok(values);
            }
        }
    }
    let asset = crate::inspect(path, "waveform".into())?;
    if !asset.has_audio {
        return Err("Source has no audio stream".into());
    }
    let mut child = crate::command("ffmpeg")
        .args([
            "-v",
            "error",
            "-nostdin",
            "-threads",
            "1",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
        ])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("Missing waveform output")?;
    let stderr = child.stderr.take().ok_or("Missing waveform diagnostics")?;
    let duration = asset.duration;
    let reader = std::thread::spawn(move || {
        let mut input = BufReader::new(stdout);
        let mut sample = [0u8; 4];
        let mut bins = vec![0f32; 400];
        let mut index = 0usize;
        loop {
            match input.read_exact(&mut sample) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(e.to_string()),
            }
            let value = f32::from_le_bytes(sample);
            let bin = ((index as f64 / (duration * 8000.)) * 400.)
                .floor()
                .clamp(0., 399.) as usize;
            if value.is_finite() {
                bins[bin] = bins[bin].max(value.abs().min(1.));
            }
            index += 1;
        }
        if index == 0 {
            Err("No decoded audio samples".into())
        } else {
            Ok(bins)
        }
    });
    let log = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.take(8192).read_to_string(&mut text);
        text
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Ok(s),
            Err(e) => break Err(e.to_string()),
            _ => {}
        }
        if started.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            break Err("Waveform analysis exceeded the 60-second budget".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let _ = child.kill();
    let _ = child.wait();
    let values = reader.join().map_err(|_| "Waveform worker failed")?;
    let log = log.join().unwrap_or_default();
    if !status?.success() {
        return Err(format!("Waveform decoding failed: {log}"));
    }
    let values = values?;
    supp_project::atomic_write(
        &out,
        &serde_json::to_vec(&values).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    prune(root, &out)?;
    Ok(values)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fingerprint_changes_when_source_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("source.wav");
        fs::write(&file, b"a").unwrap();
        let first = key(&file).unwrap();
        fs::write(&file, b"replacement").unwrap();
        assert_ne!(first, key(&file).unwrap());
    }
    #[test]
    fn cache_pruning_leaves_unrelated_files_alone() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("original.wav");
        fs::write(&file, b"source").unwrap();
        prune(dir.path(), &dir.path().join("v2-keep.jpg")).unwrap();
        assert_eq!(fs::read(file).unwrap(), b"source");
    }
}
