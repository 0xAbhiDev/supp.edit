#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod dialogs;
mod corrections;
mod lifecycle;
mod analysis;
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
        .manage(analysis::AnalysisJobs::default())
        .setup(|app| {
            std::fs::create_dir_all(app.path().app_data_dir()?)?;
            lifecycle::init(app.path().app_data_dir()?);
            corrections::init(app.path().app_data_dir()?);
            lifecycle::install_panic_hook();
            lifecycle::mark("launch", env!("CARGO_PKG_VERSION"));
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => lifecycle::mark("window close requested", window.label()),
            tauri::WindowEvent::Destroyed => lifecycle::mark("window destroyed", window.label()),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            lifecycle::lifecycle_mark,
            corrections::record_take_choice,
            project::open_project,
            project::save_project,
            project::autosave_project,
            project::recovery,
            project::discard_recovery,
            media::import_media,
            media::relink_media,
            media::get_thumbnail,
            media::get_waveform,
            media::decode_audio_pcm,
            media::import_generated_audio,
            media::extract_reference_audio,
            media::probe_capabilities,
            analysis::prepare_analysis_job,
            analysis::cancel_analysis_job,
            analysis::speech_model_status,
            analysis::vision_model_status,
            analysis::person_model_status,
            analysis::install_person_model,
            analysis::pose_model_status,
            analysis::install_pose_model,
            analysis::body_pose,
            analysis::install_vision_model,
            analysis::remove_ai_model,
            analysis::install_speech_model,
            analysis::analyze_media,
            analysis::embed_vision_query,
            analysis::sample_subjects,
            analysis::sample_color,
            analysis::reference_motion,
            analysis::reference_text,
            analysis::source_text,
            analysis::source_identity,
            analysis::reference_visual,
            analysis::person_mask,
            analysis::source_aperture,
            render::begin_export,
            render::write_frame,
            render::finish_export,
            render::cancel_export,
            render::save_png
        ])
        .build(tauri::generate_context!())
        .expect("supp.edit could not start")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                lifecycle::mark("exit", "");
            }
        });
}
