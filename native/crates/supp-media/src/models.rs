//! Explicit, checksum-verified local model installation. No media/network transport.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

pub const MODEL_ID: &str = "whisper-tiny-multilingual";
pub const VERSION: &str = "whisper.cpp-b5454-tiny-be07e048";
const RUNTIME_BYTES: u64 = 8_928_640;
const MODEL_BYTES: u64 = 77_691_713;
const RUNTIME_HASH: &str = "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb";
const MODEL_HASH: &str = "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub version: &'static str,
    pub size_bytes: u64,
    pub download_bytes: u64,
    pub installed: bool,
    pub install_supported: bool,
    pub device: &'static str,
}
#[derive(Clone, Serialize)]
pub struct Progress {
    pub completed: u64,
    pub total: u64,
    pub unit: &'static str,
}
pub fn location(root: &Path) -> PathBuf {
    root.join(VERSION)
}
pub fn paths(root: &Path) -> (PathBuf, PathBuf) {
    let base = location(root);
    (
        base.join("runtime/Release/whisper-cli.exe"),
        base.join("ggml-tiny.bin"),
    )
}
pub fn status(root: &Path) -> ModelStatus {
    let (cli, model) = paths(root);
    ModelStatus {
        id: MODEL_ID,
        name: "Whisper Tiny · multilingual",
        version: VERSION,
        size_bytes: MODEL_BYTES,
        download_bytes: MODEL_BYTES + RUNTIME_BYTES,
        installed: cli.is_file()
            && model.metadata().is_ok_and(|m| m.len() == MODEL_BYTES)
            && location(root).join("verified.json").is_file(),
        install_supported: cfg!(all(target_os = "windows", target_arch = "x86_64")),
        device: "CPU",
    }
}
fn download(
    url: &str,
    path: &Path,
    expected: u64,
    hash: &str,
    offset: u64,
    cancel: &AtomicBool,
    report: &impl Fn(Progress),
) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0u8; 65536];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Installation cancelled".into());
        }
        let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        if bytes > expected {
            return Err("Download exceeded the pinned size".into());
        }
        digest.update(&buffer[..n]);
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        report(Progress {
            completed: offset + bytes,
            total: MODEL_BYTES + RUNTIME_BYTES,
            unit: "bytes",
        });
    }
    if bytes != expected || format!("{:x}", digest.finalize()) != hash {
        return Err("Downloaded file failed checksum verification".into());
    }
    Ok(())
}
pub fn install(
    root: &Path,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<ModelStatus, String> {
    let state = status(root);
    if state.installed {
        return Ok(state);
    }
    if !state.install_supported {
        return Err("The bundled installer currently supports Windows x64 CPU only".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temp = tempfile::tempdir_in(root).map_err(|e| e.to_string())?;
    let archive = temp.path().join("runtime.zip");
    download(
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
        &archive,
        RUNTIME_BYTES,
        RUNTIME_HASH,
        0,
        cancel,
        &report,
    )?;
    let mut zip = zip::ZipArchive::new(fs::File::open(archive).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let runtime = temp.path().join("runtime");
    let mut expanded = 0;
    for i in 0..zip.len() {
        if cancel.load(Ordering::Relaxed) {
            return Err("Installation cancelled".into());
        }
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        expanded += entry.size();
        if expanded > 128 * 1024 * 1024 || entry.is_symlink() {
            return Err("Invalid runtime archive".into());
        }
        let safe = entry.enclosed_name().ok_or("Invalid runtime path")?;
        let out = runtime.join(safe);
        if entry.is_dir() {
            fs::create_dir_all(out).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(out.parent().ok_or("Invalid runtime directory")?)
                .map_err(|e| e.to_string())?;
            let mut f =
                fs::File::create(&out).map_err(|e| format!("Extract {}: {e}", out.display()))?;
            std::io::copy(&mut entry, &mut f).map_err(|e| e.to_string())?;
        }
    }
    // Close the archive before publishing its parent directory on Windows.
    drop(zip);
    download(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        &temp.path().join("ggml-tiny.bin"),
        MODEL_BYTES,
        MODEL_HASH,
        RUNTIME_BYTES,
        cancel,
        &report,
    )?;
    if !runtime.join("Release/whisper-cli.exe").is_file() {
        return Err("Runtime archive has no CLI".into());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Installation cancelled".into());
    }
    fs::write(
        temp.path().join("verified.json"),
        format!("{{\"runtime\":\"{RUNTIME_HASH}\",\"model\":\"{MODEL_HASH}\"}}"),
    )
    .map_err(|e| e.to_string())?;
    let dest = location(root);
    // A failed setup never replaces an installed version. Only a fully verified directory is published.
    if dest.exists() {
        return Err(
            "An incomplete installation exists; remove it through model management first".into(),
        );
    }
    fs::rename(temp.path(), dest)
        .map_err(|e| format!("Publish verified model installation: {e}"))?;
    Ok(status(root))
}
