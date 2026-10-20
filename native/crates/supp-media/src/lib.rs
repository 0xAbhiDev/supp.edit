//! Media tools are invoked with argument arrays, never shell command strings.
pub mod cache;
pub mod hardware;
mod process;
use serde::Serialize;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::UNIX_EPOCH,
};
use supp_project::Asset;

pub fn executable(name: &str) -> PathBuf {
    std::env::var_os(format!("SUPP_{}", name.to_uppercase()))
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| name.into())
}
pub fn command(name: &str) -> Command {
    let mut command = Command::new(executable(name));
    command.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub ffmpeg: bool,
    pub ffprobe: bool,
    pub ffmpeg_version: String,
    pub encoders: Vec<String>,
    pub hardware_accels: Vec<String>,
    pub cpu_cores: usize,
    pub platform: String,
    pub machine: hardware::Machine,
}
pub fn capabilities() -> Capabilities {
    let version = process::capture(
        command("ffmpeg").arg("-version"),
        std::time::Duration::from_secs(8),
        1024 * 1024,
    );
    let ffmpeg = version.as_ref().is_ok_and(|o| o.status.success());
    let ffmpeg_version = version
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .to_string()
        })
        .unwrap_or_default();
    let encoders: Vec<String> = process::capture(
        command("ffmpeg").args(["-hide_banner", "-encoders"]),
        std::time::Duration::from_secs(8),
        1024 * 1024,
    )
    .ok()
    .map(|o| {
        String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter_map(|l| {
                let v: Vec<_> = l.split_whitespace().collect();
                (v.len() > 1 && v[0].len() == 6 && v[1] != "=").then(|| v[1].to_owned())
            })
            .collect()
    })
    .unwrap_or_default();
    let hardware_accels: Vec<String> = process::capture(
        command("ffmpeg").args(["-hide_banner", "-hwaccels"]),
        std::time::Duration::from_secs(8),
        1024 * 1024,
    )
    .ok()
    .map(|o| {
        String::from_utf8_lossy(&o.stdout)
            .lines()
            .skip(1)
            .filter(|l| !l.trim().is_empty())
            .map(str::to_owned)
            .collect()
    })
    .unwrap_or_default();
    let machine = hardware::probe(&encoders, &hardware_accels);
    Capabilities {
        ffmpeg,
        ffprobe: process::capture(
            command("ffprobe").arg("-version"),
            std::time::Duration::from_secs(8),
            1024 * 1024,
        )
        .is_ok_and(|o| o.status.success()),
        ffmpeg_version,
        encoders,
        hardware_accels,
        cpu_cores: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        platform: std::env::consts::OS.into(),
        machine,
    }
}
pub fn validate_path(path: &Path) -> Result<PathBuf, String> {
    let path = path
        .canonicalize()
        .map_err(|e| format!("Media is offline: {} ({e})", path.display()))?;
    if !path.is_file() {
        return Err("Media must be a regular file".into());
    }
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ![
        "mp4", "mov", "mkv", "webm", "avi", "m4v", "wav", "mp3", "m4a", "aac", "flac", "ogg",
        "aif", "aiff", "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff",
    ]
    .contains(&ext.as_str())
    {
        return Err(format!("Unsupported media extension: .{ext}"));
    }
    Ok(path)
}
pub fn inspect(path: &Path, id: String) -> Result<Asset, String> {
    let path = validate_path(path)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let output = process::capture(
        command("ffprobe")
            .args([
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
            ])
            .arg(&path),
        std::time::Duration::from_secs(20),
        4 * 1024 * 1024,
    )
    .map_err(|e| {
        format!("FFprobe is required. Install FFmpeg and add it to PATH, or set SUPP_FFPROBE. {e}")
    })?;
    if !output.status.success() {
        return Err(format!(
            "Cannot inspect media: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let v: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let streams = v["streams"].as_array().ok_or("No media streams found")?;
    let video = streams.iter().find(|s| s["codec_type"] == "video");
    let audio = streams.iter().find(|s| s["codec_type"] == "audio");
    let ext = path
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_lowercase();
    let image = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].contains(&ext.as_str());
    if video.is_none() && audio.is_none() {
        return Err("No supported audio or video stream".into());
    }
    let stream = video.or(audio).unwrap();
    let duration = v["format"]["duration"]
        .as_str()
        .and_then(|x| x.parse::<f64>().ok())
        .or_else(|| stream["duration"].as_str().and_then(|x| x.parse().ok()))
        .unwrap_or(0.);
    if !image && (!duration.is_finite() || duration <= 0.) {
        return Err("Media has no usable duration".into());
    }
    let fps = video
        .and_then(|x| x["avg_frame_rate"].as_str())
        .and_then(|s| s.split_once('/'))
        .and_then(|(n, d)| Some(n.parse::<f64>().ok()? / d.parse::<f64>().ok()?))
        .filter(|f| f.is_finite())
        .unwrap_or(0.);
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(Asset {
        id,
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        kind: if image {
            "image"
        } else if video.is_some() {
            "video"
        } else {
            "audio"
        }
        .into(),
        path: path.to_string_lossy().into(),
        size: meta.len(),
        duration: if image { 0. } else { duration },
        width: stream["width"].as_u64().unwrap_or(0) as u32,
        height: stream["height"].as_u64().unwrap_or(0) as u32,
        fps,
        codec: stream["codec_name"].as_str().unwrap_or("unknown").into(),
        has_audio: audio.is_some(),
        fingerprint: format!("{}:{}:{}", path.display(), meta.len(), modified),
    })
}
pub fn thumbnail(path: &Path, out: &Path) -> Result<(), String> {
    let output = process::capture(
        command("ffmpeg")
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
            .args(["-frames:v", "1", "-vf", "scale=320:-2", "-y"])
            .arg(out),
        std::time::Duration::from_secs(30),
        1024,
    )
    .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_arbitrary_file_types() {
        assert!(validate_path(Path::new("Cargo.toml")).is_err());
    }
}
