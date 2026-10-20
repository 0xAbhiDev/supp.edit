#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod media;
mod project;
mod render;
use std::{collections::HashSet, path::PathBuf, sync::Mutex};
use tauri::Manager;

#[derive(Default)]
pub struct Session {
    allowed: Mutex<HashSet<PathBuf>>,
    project_path: Mutex<Option<PathBuf>>,
    encoder: Mutex<Option<supp_export::Encoder>>,
}
impl Session {
    fn grant(&self, path: PathBuf) -> Result<(), String> {
        self.allowed.lock().map_err(|e| e.to_string())?.insert(path);
        Ok(())
    }
    fn require(&self, path: &std::path::Path) -> Result<PathBuf, String> {
        let path = supp_media::validate_path(path)?;
        if !self
            .allowed
            .lock()
            .map_err(|e| e.to_string())?
            .contains(&path)
        {
            return Err("File access has not been granted by import or open project".into());
        }
        Ok(path)
    }
}
fn main() {
    tauri::Builder::default()
        .manage(Session::default())
        .setup(|app| {
            std::fs::create_dir_all(app.path().app_data_dir()?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project::open_project,
            project::save_project,
            project::autosave_project,
            project::recovery,
            project::discard_recovery,
            media::import_media,
            media::relink_media,
            media::get_thumbnail,
            media::get_waveform,
            media::probe_capabilities,
            render::begin_export,
            render::write_frame,
            render::finish_export,
            render::cancel_export,
            render::save_png
        ])
        .run(tauri::generate_context!())
        .expect("supp.edit could not start");
}
