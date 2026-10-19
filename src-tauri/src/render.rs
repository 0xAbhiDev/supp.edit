use crate::Session;
use supp_project::Project;
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Manager,
};
#[tauri::command]
pub async fn begin_export(app: AppHandle, project: Project) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project.validate().map_err(|e| e.to_string())?;
        let state = app.state::<Session>();
        let mut slot = state.encoder.lock().map_err(|e| e.to_string())?;
        if slot.is_some() {
            return Err("A render is already running".into());
        }
        for a in &project.assets {
            if project
                .clips
                .iter()
                .any(|c| c.asset_id.as_ref() == Some(&a.id))
            {
                state.require(std::path::Path::new(&a.path))?;
            }
        }
        let Some(output) = rfd::FileDialog::new()
            .add_filter("MP4 video", &["mp4"])
            .set_file_name("render.mp4")
            .save_file()
        else {
            return Ok(None);
        };
        if let Ok(target) = output.canonicalize() {
            if project.assets.iter().any(|a| {
                std::path::Path::new(&a.path)
                    .canonicalize()
                    .is_ok_and(|source| source == target)
            }) {
                return Err("Export cannot overwrite original media. Choose another file.".into());
            }
        }
        let name = output.to_string_lossy().to_string();
        *slot = Some(supp_export::Encoder::start(&project, output)?);
        Ok(Some(name))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn write_frame(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary PNG frame".into());
    };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Session>()
            .encoder
            .lock()
            .map_err(|e| e.to_string())?
            .as_mut()
            .ok_or("No active render")?
            .frame(&bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn finish_export(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let encoder = app
            .state::<Session>()
            .encoder
            .lock()
            .map_err(|e| e.to_string())?
            .take()
            .ok_or("No active render")?;
        encoder.finish().map(|p| p.to_string_lossy().into())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cancel_export(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Session>()
            .encoder
            .lock()
            .map_err(|e| e.to_string())?
            .take();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_png(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected PNG bytes".into());
    };
    if bytes.len() < 24 || bytes.len() > 128 * 1024 * 1024 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("Invalid PNG output".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("PNG image", &["png"])
            .set_file_name("frame.png")
            .save_file()
        else {
            return Ok(None);
        };
        if let Ok(canonical) = path.canonicalize() {
            if app
                .state::<Session>()
                .allowed
                .lock()
                .map_err(|e| e.to_string())?
                .contains(&canonical)
            {
                return Err("Cannot overwrite an original source. Choose a new file.".into());
            }
        }
        supp_project::atomic_write(&path, &bytes).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
