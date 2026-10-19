use crate::Session;
use serde::{Deserialize, Serialize};
use supp_project::Project;
use tauri::{AppHandle, Manager};
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub project: Project,
    pub path: Option<String>,
    pub missing: Vec<String>,
}
pub fn authorize(app: &AppHandle, p: &Project) -> Result<Vec<String>, String> {
    let state = app.state::<Session>();
    let mut missing = vec![];
    for asset in &p.assets {
        match supp_media::validate_path(std::path::Path::new(&asset.path)) {
            Ok(path) => {
                state.grant(path.clone())?;
                app.asset_protocol_scope()
                    .allow_file(path)
                    .map_err(|e| e.to_string())?
            }
            Err(_) => missing.push(asset.id.clone()),
        }
    }
    Ok(missing)
}
#[tauri::command]
pub async fn open_project(app: AppHandle) -> Result<Option<Opened>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("supp.edit project", &["supp", "suppedit", "bak"])
            .pick_file()
        else {
            return Ok(None);
        };
        let p = supp_project::read(&path).map_err(|e| e.to_string())?;
        let missing = authorize(&app, &p)?;
        *app.state::<Session>()
            .project_path
            .lock()
            .map_err(|e| e.to_string())? = Some(path.clone());
        Ok(Some(Opened {
            project: p,
            path: Some(path.to_string_lossy().into()),
            missing,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_project(
    app: AppHandle,
    project: Project,
    save_as: bool,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project.validate().map_err(|e| e.to_string())?;
        let state = app.state::<Session>();
        let old = state
            .project_path
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        let path = if save_as || old.is_none() {
            rfd::FileDialog::new()
                .add_filter("supp.edit project", &["supp"])
                .set_file_name("project.supp")
                .save_file()
        } else {
            old
        };
        let Some(path) = path else { return Ok(None) };
        if !["supp", "suppedit"].contains(
            &path
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_lowercase()
                .as_str(),
        ) {
            return Err("Save projects with the .supp or .suppedit extension.".into());
        }
        supp_project::save(&path, &project).map_err(|e| e.to_string())?;
        *state.project_path.lock().map_err(|e| e.to_string())? = Some(path.clone());
        Ok(Some(path.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn autosave_project(
    app: AppHandle,
    project: Project,
    path: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        project.validate().map_err(|e| e.to_string())?;
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        for i in (1..5).rev() {
            let from = dir.join(format!("recovery-{}.json", i - 1));
            if from.exists() {
                std::fs::copy(from, dir.join(format!("recovery-{i}.json")))
                    .map_err(|e| e.to_string())?;
            }
        }
        let data = serde_json::to_vec(&Opened {
            project,
            path,
            missing: vec![],
        })
        .map_err(|e| e.to_string())?;
        supp_project::atomic_write(&dir.join("recovery-0.json"), &data).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn recovery(app: AppHandle, restore: bool) -> Result<Option<Opened>, String> {
    tauri::async_runtime::spawn_blocking(move||{
        let path=app.path().app_data_dir().map_err(|e|e.to_string())?.join("recovery-0.json"); if !path.exists(){return Ok(None)}
        let mut data:Opened=serde_json::from_slice(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        data.project.validate().map_err(|e|e.to_string())?;
        if restore {data.missing=authorize(&app,&data.project)?; /* Recover to a new file; never trust a recovery-supplied save target. */ *app.state::<Session>().project_path.lock().map_err(|e|e.to_string())?=None; data.path=None;}
        Ok(Some(data))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn discard_recovery(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    for i in 0..5 {
        let path = dir.join(format!("recovery-{i}.json"));
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
