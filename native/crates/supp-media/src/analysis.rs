//! Local, fingerprinted media analysis. Results are data; this crate cannot edit a project.
pub mod audio;
pub mod aperture;
pub mod color;
pub mod speech;
pub mod video;
pub mod vision;
pub mod visual;
pub mod person_mask;
use crate::models::Progress;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, UNIX_EPOCH},
};
pub const VERSION: &str = "media-analysis-1";
const CACHE_REVISION: &str = "2";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub task: Task,
    pub language: String,
    pub translate: bool,
    pub threshold_db: f64,
    pub minimum_silence_ms: u32,
    pub padding_ms: u32,
}
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Task {
    Speech,
    Audio,
    Video,
    Vision,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            task: Task::Audio,
            language: "auto".into(),
            translate: false,
            threshold_db: -35.,
            minimum_silence_ms: 700,
            padding_ms: 100,
        }
    }
}
impl Settings {
    fn validate(&self) -> Result<(), String> {
        if !self.threshold_db.is_finite()
            || !(-80. ..=-5.).contains(&self.threshold_db)
            || !(100..=10000).contains(&self.minimum_silence_ms)
            || self.padding_ms > 2000
            || self.language.is_empty()
            || self.language.len() > 16
            || !self
                .language
                .chars()
                .all(|c| c.is_ascii_alphabetic() || c == '-')
        {
            return Err("Invalid analysis settings".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Range {
    pub start_ms: u32,
    pub end_ms: u32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisResult {
    pub asset_id: String,
    pub fingerprint: String,
    pub cache_key: String,
    pub algorithm: String,
    pub processing: String,
    pub duration_ms: u32,
    pub settings: Settings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript: Option<supp_project::Transcript>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_detected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<audio::AudioAnalysis>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<video::VideoAnalysis>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vision: Option<vision::VisionAnalysis>,
}
pub fn check(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Analysis cancelled".into())
    } else {
        Ok(())
    }
}
pub fn run(
    root: &Path,
    model_root: &Path,
    source: &Path,
    asset_id: &str,
    settings: Settings,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<AnalysisResult, String> {
    settings.validate()?;
    check(cancel)?;
    let source = crate::validate_path(source)?;
    let asset = crate::inspect(&source, asset_id.into())?;
    if asset.duration > 1800. {
        return Err(
            "Analysis currently supports sources up to 30 minutes; trim a longer source first"
                .into(),
        );
    }
    if asset.kind == "image" {
        return Err("Temporal analysis requires video or audio".into());
    }
    let meta = fs::metadata(&source).map_err(|e| e.to_string())?;
    let stamp = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let key = format!(
        "{:x}",
        Sha256::digest(format!(
            "{VERSION}:{CACHE_REVISION}:{}:{}:{stamp}:{}:{}",
            match settings.task {
                Task::Speech => format!("{}:speech-parser-2", crate::models::VERSION),
                // The budget joins the key only where it differs, so shorter clips keep their caches.
                Task::Vision => match vision::vision_budget(asset.duration) {
                    (400, 160) => format!("{}:scene-vocabulary-2:dense-long-scenes-1", crate::vision_models::VERSION),
                    (frames, scenes) => format!("{}:scene-vocabulary-2:dense-long-scenes-1:budget-{frames}-{scenes}", crate::vision_models::VERSION),
                },
                Task::Audio => "ffmpeg-audio-presentation-duration-2".into(),
                _ => "ffmpeg-classical-1".into(),
            },
            asset.fingerprint,
            asset_id,
            serde_json::to_string(&settings).map_err(|e| e.to_string())?
        ))
    );
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let cache = root.join(format!("{key}.json"));
    if cache.metadata().is_ok_and(|m| m.len() <= 16 * 1024 * 1024) {
        if let Ok(value) = fs::read(&cache).and_then(|bytes| {
            serde_json::from_slice::<AnalysisResult>(&bytes).map_err(std::io::Error::other)
        }) {
            if value.cache_key == key && value.fingerprint == asset.fingerprint {
                check(cancel)?;
                return Ok(value);
            }
        }
    }
    let mut result = AnalysisResult {
        asset_id: asset.id.clone(),
        fingerprint: asset.fingerprint.clone(),
        cache_key: key,
        algorithm: VERSION.into(),
        processing: "LOCAL".into(),
        duration_ms: (asset.duration * 1000.).round() as u32,
        settings: settings.clone(),
        transcript: None,
        speech_detected: None,
        audio: None,
        video: None,
        vision: None,
    };
    match settings.task {
        Task::Speech => {
            result.transcript =
                speech::transcribe(model_root, &source, &asset, &settings, cancel, &report)?;
            result.speech_detected = Some(result.transcript.is_some());
        }
        Task::Audio => {
            result.audio = Some(audio::analyze(&source, &asset, &settings, cancel, &report)?)
        }
        Task::Video => result.video = Some(video::analyze(&source, &asset, cancel, &report)?),
        Task::Vision => {
            let video = video::analyze(&source, &asset, cancel, &report)?;
            result.vision = Some(vision::analyze(
                &source, &asset, model_root, &video, cancel, &report,
            )?);
            result.video = Some(video);
        }
    }
    check(cancel)?;
    let after = fs::metadata(&source).map_err(|e| e.to_string())?;
    if after.len() != meta.len() || after.modified().ok() != meta.modified().ok() {
        return Err("Source changed during analysis; run it again".into());
    }
    supp_project::atomic_write(
        &cache,
        &serde_json::to_vec(&result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(result)
}
pub fn execute(
    command: &mut std::process::Command,
    cancel: &AtomicBool,
    max: usize,
) -> Result<Vec<u8>, String> {
    let output = crate::process::capture_cancel(command, Duration::from_secs(1800), max, cancel)?;
    if !output.status.success() {
        return Err(format!(
            "Local analysis failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(output.stdout)
}
pub mod reference;
pub mod reference_text;
