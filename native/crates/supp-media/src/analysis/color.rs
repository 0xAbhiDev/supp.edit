//! Small source-range RGB measurements for conservative, editable shot matching.
use super::{check, execute, Range};
use crate::models::Progress;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, sync::atomic::AtomicBool, time::UNIX_EPOCH};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorStats {
    pub asset_id: String,
    pub fingerprint: String,
    pub cache_key: String,
    pub algorithm: String,
    pub processing: String,
    pub range: Range,
    pub mean_luma: f64,
    pub contrast_std: f64,
    pub mean_saturation: f64,
    pub neutral_temperature: Option<f64>,
    pub neutral_fraction: f64,
    pub sample_count: u32,
}
fn measure(bytes: &[u8]) -> (f64, f64, f64, Option<f64>, f64) {
    let (mut sum, mut square, mut sat, mut temperature, mut neutrals) = (0., 0., 0., 0., 0.);
    let count = (bytes.len() / 3) as f64;
    for p in bytes.chunks_exact(3) {
        let (r, g, b) = (p[0] as f64 / 255., p[1] as f64 / 255., p[2] as f64 / 255.);
        let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let hi = r.max(g).max(b);
        let lo = r.min(g).min(b);
        let saturation = if hi > 0.02 { (hi - lo) / hi } else { 0. };
        sum += luma;
        square += luma * luma;
        sat += saturation;
        if saturation < 0.18 && (0.15..0.9).contains(&luma) {
            temperature += (r - b) / (r + b).max(0.01);
            neutrals += 1.;
        }
    }
    (
        sum / count,
        (square / count - (sum / count).powi(2)).max(0.).sqrt(),
        sat / count,
        (neutrals / count >= 0.02).then_some(temperature / neutrals.max(1.)),
        neutrals / count,
    )
}
pub fn run(
    root: &Path,
    source: &Path,
    asset_id: &str,
    range: Range,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<ColorStats, String> {
    check(cancel)?;
    let source = crate::validate_path(source)?;
    let asset = crate::inspect(&source, asset_id.into())?;
    if asset.kind != "video"
        || range.end_ms <= range.start_ms
        || range.end_ms as f64 > asset.duration * 1000. + 1.
        || range.end_ms - range.start_ms > 300_000
    {
        return Err("Color sampling requires a valid video range up to 5 minutes".into());
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
            "color-samples-1:{asset_id}:{}:{stamp}:{}:{}",
            asset.fingerprint, range.start_ms, range.end_ms
        ))
    );
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let cache = root.join(format!("{key}.json"));
    if cache.metadata().is_ok_and(|m| m.len() < 16_384) {
        if let Ok(bytes) = fs::read(&cache) {
            if let Ok(data) = serde_json::from_slice::<ColorStats>(&bytes) {
                if data.cache_key == key
                    && data.fingerprint == asset.fingerprint
                    && data.asset_id == asset_id
                {
                    check(cancel)?;
                    return Ok(data);
                }
            }
        }
    }
    let mut bytes = Vec::new();
    for i in 0..5 {
        check(cancel)?;
        let time = (range.start_ms as f64
            + (range.end_ms - range.start_ms) as f64 * (i as f64 + 0.5) / 5.)
            / 1000.;
        let frame = execute(
            crate::command("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-nostdin",
                    "-threads",
                    "2",
                    "-ss",
                    &format!("{time:.9}"),
                    "-protocol_whitelist",
                    "file,pipe",
                    "-i",
                ])
                .arg(&source)
                .args([
                    "-map",
                    "0:v:0",
                    "-an",
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=96:54:out_range=full,format=rgb24",
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]),
            cancel,
            96 * 54 * 3 + 1024,
        )?;
        if frame.len() != 96 * 54 * 3 {
            return Err("No complete RGB frame for shot matching".into());
        }
        bytes.extend(frame);
        report(Progress {
            completed: i + 1,
            total: 5,
            unit: "color samples",
        });
    }
    check(cancel)?;
    let after = fs::metadata(&source).map_err(|e| e.to_string())?;
    if after.len() != meta.len() || after.modified().ok() != meta.modified().ok() {
        return Err("Source changed during color sampling".into());
    }
    let (mean_luma, contrast_std, mean_saturation, neutral_temperature, neutral_fraction) =
        measure(&bytes);
    let result = ColorStats {
        asset_id: asset.id,
        fingerprint: asset.fingerprint,
        cache_key: key,
        algorithm: "color-samples-1".into(),
        processing: "LOCAL".into(),
        range,
        mean_luma,
        contrast_std,
        mean_saturation,
        neutral_temperature,
        neutral_fraction,
        sample_count: 5,
    };
    supp_project::atomic_write(
        &cache,
        &serde_json::to_vec(&result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rgb_proxies_are_pixel_measurements() {
        let gray = vec![128; 300];
        let (mean, contrast, sat, temp, fraction) = measure(&gray);
        assert!((mean - 128. / 255.).abs() < 1e-8);
        assert!(contrast < 1e-7);
        assert_eq!(sat, 0.);
        assert_eq!(temp, Some(0.));
        assert_eq!(fraction, 1.);
        let warm: Vec<u8> = (0..100).flat_map(|_| [140, 135, 130]).collect();
        assert!(measure(&warm).3.unwrap() > 0.);
        let red: Vec<u8> = (0..100).flat_map(|_| [255, 0, 0]).collect();
        assert_eq!(measure(&red).3, None);
    }
}
