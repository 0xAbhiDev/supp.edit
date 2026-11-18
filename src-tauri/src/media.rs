use crate::Session;
use serde::Serialize;
use tauri::{AppHandle, Manager};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub asset: supp_project::Asset,
    pub thumbnail: Option<String>,
}
#[derive(Serialize)]
pub struct ImportResult {
    pub imported: Vec<Imported>,
    pub errors: Vec<String>,
}
fn import_one(app: &AppHandle, path: &std::path::Path, id: String) -> Result<Imported, String> {
    let asset = supp_media::inspect(path, id)?;
    let path = std::path::PathBuf::from(&asset.path);
    app.state::<Session>().grant(path.clone())?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    // Metadata returns first. The library requests derived media on the background analysis worker.
    Ok(Imported {
        asset,
        thumbnail: None,
    })
}
#[tauri::command]
pub async fn import_media(app: AppHandle) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = crate::dialogs::run(|| rfd::FileDialog::new()
            .add_filter(
                "Media",
                &[
                    "mp4", "mov", "mkv", "webm", "avi", "m4v", "wav", "mp3", "m4a", "aac", "flac",
                    "ogg", "aif", "aiff", "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff",
                ],
            )
            .pick_files())
            .unwrap_or_default();
        let mut result = ImportResult {
            imported: vec![],
            errors: vec![],
        };
        for path in paths {
            match import_one(&app, &path, uuid::Uuid::new_v4().to_string()) {
                Ok(item) => result.imported.push(item),
                Err(e) => result.errors.push(format!("{}: {e}", path.display())),
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn relink_media(app: AppHandle, asset_id: String) -> Result<Option<Imported>, String> {
    // Project IDs are opaque; derived cache paths are fingerprint hashes.
    if !supp_project::valid_id(&asset_id) {
        return Err("Invalid asset ID".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = crate::dialogs::run(|| rfd::FileDialog::new()
            .set_title("Relink source media")
            .pick_file())
        else {
            return Ok(None);
        };
        import_one(&app, &path, asset_id).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn probe_capabilities() -> Result<supp_media::Capabilities, String> {
    static CAPABILITIES: std::sync::OnceLock<supp_media::Capabilities> = std::sync::OnceLock::new();
    tauri::async_runtime::spawn_blocking(|| {
        CAPABILITIES.get_or_init(supp_media::capabilities).clone()
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn get_thumbnail(
    app: AppHandle,
    asset_id: String,
    path: String,
) -> Result<Option<String>, String> {
    if !supp_project::valid_id(&asset_id) {
        return Err("Invalid asset ID".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let source = app
            .state::<Session>()
            .require(std::path::Path::new(&path))?;
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("derived-v2");
        let thumb = supp_media::cache::thumbnail(&cache, &source)?;
        app.asset_protocol_scope()
            .allow_file(&thumb)
            .map_err(|e| e.to_string())?;
        Ok(Some(thumb.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn get_waveform(app: AppHandle, path: String) -> Result<Vec<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = app
            .state::<Session>()
            .require(std::path::Path::new(&path))?;
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("derived-v2");
        supp_media::cache::waveform(&cache, &source)
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Decoded audio of an authorized project file for local analysis (stereo s16le, 22.05 kHz).
#[tauri::command]
pub async fn decode_audio_pcm(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = app
            .state::<Session>()
            .require(std::path::Path::new(&path))?;
        supp_media::decode_pcm(&source, 22050, 600.).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Store a locally generated sound (WAV bytes made in the editor) in the app's data folder and
/// import it like any other media. The name is reduced to safe characters; content decides the
/// file name, so the same sound is stored once.
#[tauri::command]
pub async fn import_generated_audio(app: AppHandle, name: String, bytes: Vec<u8>) -> Result<Imported, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if bytes.len() < 44 || bytes.len() > 64 * 1024 * 1024 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
            return Err("Generated audio must be a WAV file under 64 MB".into());
        }
        store_audio(&app, &name, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
/// The soundtrack of an imported video as its own 48 kHz stereo WAV asset, so it can be used as an
/// ordinary audio clip. The video file is only read; the WAV is written to the app's data folder.
#[tauri::command]
pub async fn extract_reference_audio(app: AppHandle, path: String) -> Result<Imported, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = app.state::<Session>().require(std::path::Path::new(&path))?;
        let pcm = supp_media::decode_pcm(&source, 48000, 600.)?;
        let mut bytes = Vec::with_capacity(44 + pcm.len());
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&u32::try_from(36 + pcm.len()).map_err(|_| "Soundtrack too long")?.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&48000u32.to_le_bytes());
        bytes.extend_from_slice(&(48000u32 * 4).to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&u32::try_from(pcm.len()).map_err(|_| "Soundtrack too long")?.to_le_bytes());
        bytes.extend_from_slice(&pcm);
        store_audio(&app, "reference-audio", &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn store_audio(app: &AppHandle, name: &str, bytes: &[u8]) -> Result<Imported, String> {
    {
        let mut hash: u64 = 0xcbf29ce484222325;
        for b in bytes {
            hash = (hash ^ u64::from(*b)).wrapping_mul(0x100000001b3);
        }
        let stem: String = name
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(40)
            .collect();
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("generated-audio");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("{}-{hash:016x}.wav", if stem.is_empty() { "sound" } else { &stem }));
        if !path.exists() {
            supp_project::atomic_write(&path, bytes).map_err(|e| e.to_string())?;
        }
        import_one(app, &path, format!("generated-{hash:016x}"))
    }
}
