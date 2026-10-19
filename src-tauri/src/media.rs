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
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let thumb = cache.join(format!("{}.jpg", asset.id));
    let thumbnail = if asset.kind != "audio" && supp_media::thumbnail(&path, &thumb).is_ok() {
        app.asset_protocol_scope()
            .allow_file(&thumb)
            .map_err(|e| e.to_string())?;
        Some(thumb.to_string_lossy().into())
    } else {
        None
    };
    Ok(Imported { asset, thumbnail })
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
    // UUID is used as a cache filename; reject traversal and arbitrary names.
    uuid::Uuid::parse_str(&asset_id).map_err(|_| "Invalid asset ID")?;
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
    tauri::async_runtime::spawn_blocking(supp_media::capabilities)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn get_thumbnail(
    app: AppHandle,
    asset_id: String,
    path: String,
) -> Result<Option<String>, String> {
    uuid::Uuid::parse_str(&asset_id).map_err(|_| "Invalid asset ID")?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = app
            .state::<Session>()
            .require(std::path::Path::new(&path))?;
        let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let thumb = cache.join(format!("{asset_id}.jpg"));
        if !thumb.exists() {
            supp_media::thumbnail(&source, &thumb)?;
        }
        app.asset_protocol_scope()
            .allow_file(&thumb)
            .map_err(|e| e.to_string())?;
        Ok(Some(thumb.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
