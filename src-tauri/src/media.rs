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
        let paths = rfd::FileDialog::new()
            .add_filter(
                "Media",
                &[
                    "mp4", "mov", "mkv", "webm", "avi", "m4v", "wav", "mp3", "m4a", "aac", "flac",
                    "ogg", "aif", "aiff", "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff",
                ],
            )
            .pick_files()
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
        let Some(path) = rfd::FileDialog::new()
            .set_title("Relink source media")
            .pick_file()
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
