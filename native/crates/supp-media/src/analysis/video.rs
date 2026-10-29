use super::{check, execute};
use crate::models::Progress;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::atomic::AtomicBool};
use supp_project::Asset;
const WIDTH: usize = 96;
const HEIGHT: usize = 54;
const PIXELS: usize = WIDTH * HEIGHT;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualitySample {
    pub time_ms: u32,
    pub mean_luma: f64,
    pub dark_fraction: f64,
    pub clipped_fraction: f64,
    pub laplacian_variance: f64,
    pub frame_difference: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub start_ms: u32,
    pub end_ms: u32,
    pub representative_ms: u32,
    pub boundary_score: Option<f64>,
    pub motion: Option<f64>,
    pub sharpness: Option<f64>,
    pub black_fraction: Option<f64>,
    pub frozen_fraction: Option<f64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoAnalysis {
    pub scenes: Vec<Scene>,
    pub quality: Vec<QualitySample>,
    pub method: String,
}
pub fn analyze(
    source: &Path,
    asset: &Asset,
    cancel: &AtomicBool,
    report: &impl Fn(Progress),
) -> Result<VideoAnalysis, String> {
    if asset.kind != "video" {
        return Err("Scene analysis requires video".into());
    }
    // Every decoded frame participates in cut detection, at a small spatial resolution.
    // The print filter writes measured scene scores to stdout, not a generated estimate.
    let boundaries = execute(
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
                "0:v:0",
                "-an",
                "-vf",
                "scale=160:90,select=gt(scene\\,0.3),metadata=print:file=-",
                "-f",
                "null",
                "-",
            ]),
        cancel,
        1024 * 1024,
    )?;
    report(Progress {
        completed: 1,
        total: 3,
        unit: "stages",
    });
    let bytes = execute(
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
                "0:v:0",
                "-an",
                "-vf",
                "fps=2,scale=96:54",
                "-pix_fmt",
                "gray",
                "-f",
                "rawvideo",
                "pipe:1",
            ]),
        cancel,
        20 * 1024 * 1024,
    )?;
    report(Progress {
        completed: 2,
        total: 3,
        unit: "stages",
    });
    let duration = (asset.duration * 1000.).round() as u32;
    let mut cuts = vec![(0, None)];
    let mut time = None;
    for line in String::from_utf8_lossy(&boundaries).lines() {
        if let Some(value) = line.split("pts_time:").nth(1) {
            time = value
                .trim()
                .parse::<f64>()
                .ok()
                .filter(|v| v.is_finite() && *v >= 0.)
                .map(|v| (v * 1000.).round() as u32);
        } else if let Some(value) = line.strip_prefix("lavfi.scene_score=") {
            if let (Some(t), Ok(score)) = (time.take(), value.parse::<f64>()) {
                if score.is_finite() && t > cuts.last().map_or(0, |c| c.0) && t < duration {
                    cuts.push((t, Some(score.clamp(0., 1.))));
                }
            }
        }
    }
    if cuts.len() > 2000 {
        return Err("Scene detection exceeds 2,000 scenes per asset".into());
    }
    let mut quality = Vec::new();
    let mut previous: Option<&[u8]> = None;
    for (i, frame) in bytes.chunks_exact(PIXELS).enumerate() {
        check(cancel)?;
        quality.push(measure(frame, previous, (i * 500) as u32));
        previous = Some(frame);
    }
    if quality.is_empty() {
        return Err("No video frames decoded for quality analysis".into());
    }
    let scenes = cuts
        .iter()
        .enumerate()
        .map(|(i, (start, score))| {
            let end = cuts.get(i + 1).map_or(duration, |c| c.0);
            let samples: Vec<_> = quality
                .iter()
                .filter(|q| q.time_ms >= *start && q.time_ms < end)
                .collect();
            let count = samples.len().max(1) as f64;
            // Frame differences across a cut are excluded from motion/freeze evidence.
            let motion_samples: Vec<_> = samples
                .iter()
                .filter(|q| q.time_ms >= start + 500)
                .collect();
            let motion_count = motion_samples.len().max(1) as f64;
            Scene {
                start_ms: *start,
                end_ms: end,
                representative_ms: start + (end - start) / 2,
                boundary_score: *score,
                motion: (!motion_samples.is_empty()).then(|| {
                    motion_samples
                        .iter()
                        .map(|q| q.frame_difference)
                        .sum::<f64>()
                        / motion_count
                }),
                sharpness: (!samples.is_empty())
                    .then(|| samples.iter().map(|q| q.laplacian_variance).sum::<f64>() / count),
                black_fraction: (!samples.is_empty()).then(|| {
                    samples.iter().filter(|q| q.dark_fraction > 0.98).count() as f64 / count
                }),
                frozen_fraction: (!motion_samples.is_empty()).then(|| {
                    motion_samples
                        .iter()
                        .filter(|q| q.frame_difference < 0.001)
                        .count() as f64
                        / motion_count
                }),
            }
        })
        .collect();
    report(Progress {
        completed: 3,
        total: 3,
        unit: "stages",
    });
    Ok(VideoAnalysis { scenes, quality, method: "FFmpeg scene scores > 0.30 on every frame at 160×90; luma, Laplacian variance and frame differences sampled at 2 Hz (96×54). No artistic-quality or exercise classifier.".into() })
}
fn measure(frame: &[u8], previous: Option<&[u8]>, time_ms: u32) -> QualitySample {
    let n = frame.len() as f64;
    let mut sum = 0.;
    let mut square = 0.;
    let mut count = 0.;
    for y in 1..HEIGHT - 1 {
        for x in 1..WIDTH - 1 {
            let i = y * WIDTH + x;
            let lap = 4. * f64::from(frame[i])
                - f64::from(frame[i - 1])
                - f64::from(frame[i + 1])
                - f64::from(frame[i - WIDTH])
                - f64::from(frame[i + WIDTH]);
            sum += lap;
            square += lap * lap;
            count += 1.;
        }
    }
    QualitySample {
        time_ms,
        mean_luma: frame.iter().map(|v| f64::from(*v) / 255.).sum::<f64>() / n,
        dark_fraction: frame.iter().filter(|v| **v <= 8).count() as f64 / n,
        clipped_fraction: frame.iter().filter(|v| **v >= 247).count() as f64 / n,
        laplacian_variance: (square / count - (sum / count).powi(2)).max(0.),
        frame_difference: previous.map_or(0., |p| {
            frame
                .iter()
                .zip(p)
                .map(|(a, b)| (f64::from(*a) - f64::from(*b)).abs() / 255.)
                .sum::<f64>()
                / n
        }),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quality_components_measure_pixels() {
        let black = vec![0; PIXELS];
        let white = vec![255; PIXELS];
        let a = measure(&black, None, 0);
        let b = measure(&white, Some(&black), 500);
        assert_eq!(a.dark_fraction, 1.);
        assert_eq!(a.laplacian_variance, 0.);
        assert_eq!(b.clipped_fraction, 1.);
        assert_eq!(b.frame_difference, 1.);
        let checker: Vec<u8> = (0..PIXELS)
            .map(|i| {
                if (i / WIDTH + i % WIDTH).is_multiple_of(2) {
                    0
                } else {
                    255
                }
            })
            .collect();
        assert!(measure(&checker, None, 0).laplacian_variance > b.laplacian_variance);
    }
}
