use crate::Session;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use supp_media::{
    analysis::{AnalysisResult, Settings},
    models::{ModelStatus, Progress},
};
use tauri::{ipc::Channel, AppHandle, Manager};
#[derive(Default)]
pub struct AnalysisJobs(Mutex<HashMap<String, (Arc<AtomicBool>, bool)>>);
fn model_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(std::env::var_os("SUPP_AI_MODELS")
        .map(PathBuf::from)
        .unwrap_or(
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("ai-models"),
        ))
}
#[tauri::command]
pub fn prepare_analysis_job(app: AppHandle) -> Result<String, String> {
    let state = app.state::<AnalysisJobs>();
    let mut jobs = state.0.lock().map_err(|e| e.to_string())?;
    if jobs.len() >= 32 {
        return Err("Native analysis queue is full".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    jobs.insert(id.clone(), (Arc::new(AtomicBool::new(false)), false));
    Ok(id)
}
#[tauri::command]
pub fn cancel_analysis_job(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AnalysisJobs>();
    let mut jobs = state.0.lock().map_err(|e| e.to_string())?;
    if let Some((cancel, started)) = jobs.get(&id) {
        cancel.store(true, Ordering::Relaxed);
        if !started {
            jobs.remove(&id);
        }
    }
    Ok(())
}
fn start(app: &AppHandle, id: &str) -> Result<Arc<AtomicBool>, String> {
    let state = app.state::<AnalysisJobs>();
    let mut jobs = state.0.lock().map_err(|e| e.to_string())?;
    if jobs.values().filter(|(_, s)| *s).count() >= 2 {
        return Err("Two native analysis tasks are already running".into());
    }
    let (cancel, started) = jobs
        .get_mut(id)
        .ok_or("Analysis job is absent or cancelled")?;
    if *started {
        return Err("Analysis job already started".into());
    }
    *started = true;
    Ok(cancel.clone())
}
fn finish(app: &AppHandle, id: &str) {
    if let Ok(mut jobs) = app.state::<AnalysisJobs>().0.lock() {
        jobs.remove(id);
    }
}
#[tauri::command]
pub async fn speech_model_status(app: AppHandle) -> Result<ModelStatus, String> {
    Ok(supp_media::models::status(&model_root(&app)?))
}
#[tauri::command]
pub async fn vision_model_status(app: AppHandle) -> Result<ModelStatus, String> {
    Ok(supp_media::vision_models::status(&model_root(&app)?))
}
#[tauri::command]
pub async fn install_vision_model(
    app: AppHandle,
    id: String,
    on_progress: Channel<Progress>,
) -> Result<ModelStatus, String> {
    let cancel = start(&app, &id)?;
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        supp_media::vision_models::install(&model_root(&worker_app)?, &cancel, |p| {
            let _ = on_progress.send(p);
        })
    })
    .await
    .map_err(|e| e.to_string());
    finish(&app, &id);
    result?
}
#[tauri::command]
pub fn remove_ai_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let state = app.state::<AnalysisJobs>();
    let jobs = state.0.lock().map_err(|e| e.to_string())?;
    if jobs.values().any(|(_, started)| *started) {
        return Err(
            "Wait for native analysis and installation to finish before removing a model".into(),
        );
    }
    let root = model_root(&app)?;
    let target = match model_id.as_str() {
        supp_media::models::MODEL_ID => supp_media::models::location(&root),
        supp_media::vision_models::MODEL_ID => supp_media::vision_models::location(&root),
        _ => return Err("Unknown installed model".into()),
    };
    if target.exists() {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let target = target.canonicalize().map_err(|e| e.to_string())?;
        if target.parent() != Some(root.as_path()) {
            return Err("Model directory is outside the managed model root".into());
        }
        std::fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn install_speech_model(
    app: AppHandle,
    id: String,
    on_progress: Channel<Progress>,
) -> Result<ModelStatus, String> {
    let cancel = start(&app, &id)?;
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        supp_media::models::install(&model_root(&worker_app)?, &cancel, |progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(|e| e.to_string());
    finish(&app, &id);
    result?
}
#[tauri::command]
pub async fn analyze_media(
    app: AppHandle,
    id: String,
    asset_id: String,
    path: String,
    settings: Settings,
    on_progress: Channel<Progress>,
) -> Result<AnalysisResult, String> {
    // Project IDs are bounded opaque strings, including legacy/imported IDs.
    // They are hashed into cache keys, never interpreted as filesystem paths.
    if !supp_project::valid_id(&asset_id) {
        return Err("Invalid asset ID".into());
    }
    let source = app
        .state::<Session>()
        .require(std::path::Path::new(&path))?;
    let cancel = start(&app, &id)?;
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let cache = worker_app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("media-analysis-v1");
        supp_media::analysis::run(
            &cache,
            &model_root(&worker_app)?,
            &source,
            &asset_id,
            settings,
            &cancel,
            |progress| {
                let _ = on_progress.send(progress);
            },
        )
    })
    .await
    .map_err(|e| e.to_string());
    finish(&app, &id);
    result?
}
#[tauri::command]
pub async fn embed_vision_query(
    app: AppHandle,
    id: String,
    query: String,
    on_progress: Channel<Progress>,
) -> Result<supp_media::analysis::vision::QueryEmbedding, String> {
    let cancel = start(&app, &id)?;
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result =
            supp_media::analysis::vision::encode_query(&model_root(&worker_app)?, &query, &cancel)?;
        let _ = on_progress.send(Progress {
            completed: 1,
            total: 1,
            unit: "query embedded",
        });
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string());
    finish(&app, &id);
    result?
}

#[tauri::command]
pub async fn sample_subjects(
    app: AppHandle,
    id: String,
    asset_id: String,
    path: String,
    sampling: supp_media::analysis::vision::subjects::Sampling,
    on_progress: Channel<Progress>,
) -> Result<supp_media::analysis::vision::subjects::SubjectSamples, String> {
    if !supp_project::valid_id(&asset_id) {
        return Err("Invalid asset ID".into());
    }
    let source = app
        .state::<Session>()
        .require(std::path::Path::new(&path))?;
    let cancel = start(&app, &id)?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let cache = worker
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("subject-samples-v1");
        supp_media::analysis::vision::subjects::run(
            &cache,
            &model_root(&worker)?,
            &source,
            &asset_id,
            sampling,
            &cancel,
            |p| {
                let _ = on_progress.send(p);
            },
        )
    })
    .await
    .map_err(|e| e.to_string());
    finish(&app, &id);
    result?
}

#[tauri::command]
pub async fn sample_color(
    app: AppHandle,
    id: String,
    asset_id: String,
    path: String,
    range: supp_media::analysis::Range,
    on_progress: Channel<Progress>,
) -> Result<supp_media::analysis::color::ColorStats, String> {
    if !supp_project::valid_id(&asset_id) {
        return Err("Invalid asset ID".into());
    }
    let source = app
        .state::<Session>()
        .require(std::path::Path::new(&path))?;
    let cancel = start(&app, &id)?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let cache = worker
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("color-samples-v1");
        supp_media::analysis::color::run(&cache, &source, &asset_id, range, &cancel, |p| {
            let _ = on_progress.send(p);
        })
    })
    .await
    .map_err(|e| e.to_string());
    finish(&app, &id);
    result?
}
#[tauri::command]
pub async fn reference_motion(
    app: AppHandle,
    id: String,
    path: String,
    on_progress: Channel<Progress>,
) -> Result<Vec<supp_media::analysis::reference::Motion>, String> {
    let source = app
        .state::<Session>()
        .require(std::path::Path::new(&path))?;
    let cancel = start(&app, &id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        supp_media::analysis::reference::run(&source, &cancel, |p| {
            let _ = on_progress.send(p);
        })
    })
    .await
    .map_err(|e| e.to_string());
    finish(&app, &id);
    result?
}
#[tauri::command]
pub async fn reference_text(
    app: AppHandle,
    id: String,
    path: String,
    on_progress: Channel<Progress>,
) -> Result<Vec<supp_media::analysis::reference_text::TextAppearance>, String> {
    let source = app
        .state::<Session>()
        .require(std::path::Path::new(&path))?;
    let cancel = start(&app, &id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        supp_media::analysis::reference_text::run(&source, &cancel, |p| {
            let _ = on_progress.send(p);
        })
    })
    .await
    .map_err(|e| e.to_string());
    finish(&app, &id);
    result?
}
