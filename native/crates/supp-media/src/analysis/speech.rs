use super::{check, execute, Settings};
use crate::models::{self, Progress};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::Path, sync::atomic::AtomicBool};
use supp_project::{Asset, Transcript, TranscriptSegment, TranscriptWord};

pub fn transcribe(
    model_root: &Path,
    source: &Path,
    asset: &Asset,
    settings: &Settings,
    cancel: &AtomicBool,
    report: &impl Fn(Progress),
) -> Result<Transcript, String> {
    if !asset.has_audio {
        return Err("Source has no audio stream".into());
    }
    if !models::status(model_root).installed {
        return Err("Install the local Whisper Tiny model in AI Studio first".into());
    }
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let wav = temp.path().join("speech.wav");
    execute(
        crate::command("ffmpeg")
            .args([
                "-v",
                "error",
                "-nostdin",
                "-threads",
                "2",
                "-protocol_whitelist",
                "file,pipe",
                "-i",
            ])
            .arg(source)
            .args([
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                "-y",
            ])
            .arg(&wav),
        cancel,
        4096,
    )?;
    report(Progress {
        completed: 1,
        total: 3,
        unit: "stages",
    });
    check(cancel)?;
    let (cli, model) = models::paths(model_root);
    let prefix = temp.path().join("transcript");
    let mut command = crate::command(cli.to_str().ok_or("Invalid runtime path")?);
    command
        .arg("-m")
        .arg(model)
        .arg("-f")
        .arg(wav)
        .args(["-l", &settings.language, "-ojf", "-ng", "-t", "4", "-of"])
        .arg(&prefix);
    if settings.translate {
        command.arg("-tr");
    }
    // Whole-source time coordinates. Do not enable upstream VAD: token offsets
    // from compressed audio would need a verified mapping back to the source.
    execute(&mut command, cancel, 4 * 1024 * 1024)?;
    report(Progress {
        completed: 2,
        total: 3,
        unit: "stages",
    });
    let json = prefix.with_extension("json");
    if fs::metadata(&json).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("Transcript exceeded 16 MiB".into());
    }
    let result = parse(
        &fs::read(&json).map_err(|e| e.to_string())?,
        asset,
        settings,
    )?;
    check(cancel)?;
    report(Progress {
        completed: 3,
        total: 3,
        unit: "stages",
    });
    Ok(result)
}
pub fn parse(bytes: &[u8], asset: &Asset, settings: &Settings) -> Result<Transcript, String> {
    let json: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let rows = json["transcription"]
        .as_array()
        .ok_or("Whisper returned no transcript")?;
    if rows.len() > 10000 {
        return Err("Transcript exceeds 10,000 segments".into());
    }
    let digest = format!(
        "{:x}",
        Sha256::digest(format!(
            "{}:{}:{}:{}:{}",
            asset.id,
            asset.fingerprint,
            models::VERSION,
            settings.language,
            settings.translate
        ))
    );
    let id = format!("speech-{}", &digest[..32]);
    let duration = (asset.duration * 1000.).ceil() as u32;
    let mut segments = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let text = row["text"].as_str().ok_or("Missing speech text")?.trim();
        let start = timestamp(&row["offsets"]["from"])?;
        let end = timestamp(&row["offsets"]["to"])?.min(duration);
        if text.is_empty() || end <= start {
            continue;
        }
        if text.chars().count() > 10000 {
            return Err("Speech segment exceeds text limit".into());
        }
        let mut words: Vec<TranscriptWord> = Vec::new();
        for token in row["tokens"].as_array().into_iter().flatten() {
            if token["id"].as_u64().is_none_or(|n| n >= 50257) {
                continue;
            }
            let Some(text) = token["text"].as_str() else {
                continue;
            };
            let (Ok(from), Ok(to)) = (
                timestamp(&token["offsets"]["from"]),
                timestamp(&token["offsets"]["to"]),
            ) else {
                continue;
            };
            if text.trim().is_empty()
                || from < start
                || to > end
                || to < from
                || words.last().is_some_and(|w| from < w.start_ms)
            {
                continue;
            }
            let confidence = token["p"]
                .as_f64()
                .filter(|p| p.is_finite() && (0. ..=1.).contains(p));
            if !text.starts_with(char::is_whitespace) && !words.is_empty() {
                let previous = words.last_mut().ok_or("Missing word")?;
                previous.text.push_str(text);
                previous.end_ms = previous.end_ms.max(to);
                previous.confidence = previous.confidence.zip(confidence).map(|(a, b)| a.min(b));
            } else {
                words.push(TranscriptWord {
                    text: text.trim().into(),
                    start_ms: from,
                    end_ms: to,
                    confidence,
                    speaker_id: None,
                });
            }
        }
        if words.len() > 10000 || words.iter().any(|w| w.text.chars().count() > 1000) {
            return Err("Word timing exceeds transcript limits".into());
        }
        segments.push(TranscriptSegment {
            id: format!("{id}-{i}"),
            text: text.into(),
            start_ms: start,
            end_ms: end,
            speaker_id: None,
            words: Some(words),
        });
    }
    if segments.is_empty() {
        return Err("No speech segments were detected".into());
    }
    if segments.windows(2).any(|p| p[1].start_ms < p[0].start_ms) {
        return Err("Whisper returned unordered segments".into());
    }
    Ok(Transcript {
        id,
        name: format!("Transcript · {}", asset.name)
            .chars()
            .take(256)
            .collect(),
        source: "transcription".into(),
        language: json["result"]["language"].as_str().map(String::from),
        asset_id: Some(asset.id.clone()),
        source_fingerprint: Some(asset.fingerprint.clone()),
        model_id: Some(models::MODEL_ID.into()),
        model_version: Some(models::VERSION.into()),
        timing_quality: Some("approximate".into()),
        translated: Some(settings.translate),
        segments,
    })
}
fn timestamp(value: &Value) -> Result<u32, String> {
    value
        .as_u64()
        .filter(|v| *v <= 604_800_000)
        .map(|v| v as u32)
        .ok_or("Invalid speech timestamp".into())
}
