use super::{check, execute, Range, Settings};
use crate::models::Progress;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::atomic::AtomicBool};
use supp_project::Asset;
const RATE: usize = 16000;
const HOP: usize = 160;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnergyPoint {
    pub time_ms: u32,
    pub rms_db: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Onset {
    pub time_ms: u32,
    pub strength: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeatMap {
    pub bpm: Option<f64>,
    pub confidence: f64,
    pub beats: Vec<Onset>,
    pub downbeats: Vec<u32>,
    pub onsets: Vec<Onset>,
    pub energy_curve: Vec<EnergyPoint>,
    pub method: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioAnalysis {
    pub silences: Vec<Range>,
    pub removal_ranges: Vec<Range>,
    pub beat_map: BeatMap,
}
pub fn analyze(
    source: &Path,
    asset: &Asset,
    settings: &Settings,
    cancel: &AtomicBool,
    report: &impl Fn(Progress),
) -> Result<AudioAnalysis, String> {
    if !asset.has_audio {
        return Err("Source has no audio stream".into());
    }
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
                "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1",
            ]),
        cancel,
        60 * 1024 * 1024,
    )?;
    report(Progress {
        completed: 1,
        total: 2,
        unit: "stages",
    });
    // AAC decoding can return trailing encoder padding beyond the presentation
    // duration. Exclude it before deriving silence, energy and beat timestamps.
    let presentation_samples = (asset.duration * RATE as f64).round() as usize;
    let pcm = &bytes[..bytes.len().min(presentation_samples.saturating_mul(2))];
    let rms: Vec<f64> = pcm
        .chunks(HOP * 2)
        .map(|chunk| {
            let sum = chunk
                .chunks_exact(2)
                .map(|b| (f64::from(i16::from_le_bytes([b[0], b[1]])) / 32768.).powi(2))
                .sum::<f64>();
            (sum / (chunk.len() / 2).max(1) as f64).sqrt()
        })
        .collect();
    let duration = ((pcm.len() / 2) as f64 * 1000. / RATE as f64)
        .round()
        .min((asset.duration * 1000.).round()) as u32;
    drop(bytes);
    let result = rms_analysis(&rms, duration, settings, cancel)?;
    report(Progress {
        completed: 2,
        total: 2,
        unit: "stages",
    });
    Ok(result)
}
#[cfg(test)]
fn samples_analysis(
    samples: &[f64],
    settings: &Settings,
    cancel: &AtomicBool,
) -> Result<AudioAnalysis, String> {
    if samples.is_empty() {
        return Err("No decoded audio samples".into());
    }
    let rms: Vec<f64> = samples
        .chunks(HOP)
        .map(|s| (s.iter().map(|v| v * v).sum::<f64>() / s.len() as f64).sqrt())
        .collect();
    let duration = (samples.len() as f64 / RATE as f64 * 1000.).round() as u32;
    rms_analysis(&rms, duration, settings, cancel)
}
fn rms_analysis(
    rms: &[f64],
    duration: u32,
    settings: &Settings,
    cancel: &AtomicBool,
) -> Result<AudioAnalysis, String> {
    if rms.is_empty() {
        return Err("No decoded audio samples".into());
    }
    let db = |v: f64| (20. * v.max(0.000001).log10()).max(-120.);
    let threshold = 10f64.powf(settings.threshold_db / 20.);
    let mut silences = Vec::new();
    let mut begin = None;
    for i in 0..=rms.len() {
        if i % 1024 == 0 {
            check(cancel)?;
        }
        let silent = i < rms.len() && rms[i] < threshold;
        if silent && begin.is_none() {
            begin = Some((i * 10) as u32);
        }
        if !silent {
            if let Some(start) = begin.take() {
                let end = ((i * 10) as u32).min(duration);
                if end - start >= settings.minimum_silence_ms {
                    silences.push(Range {
                        start_ms: start,
                        end_ms: end,
                    });
                }
            }
        }
    }
    let removal_ranges = silences
        .iter()
        .filter_map(|r| {
            let start = r.start_ms + settings.padding_ms;
            let end = r.end_ms.saturating_sub(settings.padding_ms);
            (end > start).then_some(Range {
                start_ms: start,
                end_ms: end,
            })
        })
        .collect();
    // Positive amplitude flux: measured attacks, with a local adaptive baseline.
    // This deliberately reports observed peaks, never an invented regular beat grid.
    let flux: Vec<f64> = rms
        .iter()
        .enumerate()
        .map(|(i, v)| (v - i.checked_sub(1).map_or(0., |j| rms[j])).max(0.))
        .collect();
    let peak = flux.iter().copied().fold(0., f64::max);
    let mut peaks = Vec::new();
    for i in 0..flux.len() {
        if peak < 0.001 {
            break;
        }
        let lo = i.saturating_sub(50);
        let hi = (i + 51).min(flux.len());
        let baseline = flux[lo..hi].iter().sum::<f64>() / (hi - lo) as f64;
        if flux[i] > (baseline * 2.5).max(peak * 0.08).max(0.001)
            && (i == 0 || flux[i] > flux[i - 1])
            && (i + 1 == flux.len() || flux[i] >= flux[i + 1])
        {
            if let Some(&last) = peaks.last() {
                if i - last < 8 {
                    if flux[i] > flux[last] {
                        peaks.pop();
                    } else {
                        continue;
                    }
                }
            }
            peaks.push(i);
        }
    }
    let onsets: Vec<Onset> = peaks
        .iter()
        .map(|&i| Onset {
            time_ms: (i * 10) as u32,
            strength: flux[i] / peak,
        })
        .collect();
    let mut best = (0usize, 0f64);
    if peaks.len() >= 4 {
        let energy: f64 = flux.iter().map(|v| v * v).sum();
        for lag in 30..=100 {
            // 60–200 BPM; half/double-time ambiguity is reported in the UI.
            check(cancel)?;
            if lag >= flux.len() {
                continue;
            }
            let correlation = flux[lag..]
                .iter()
                .zip(&flux[..flux.len() - lag])
                .map(|(a, b)| a * b)
                .sum::<f64>()
                / energy.max(1e-12);
            if correlation > best.1 {
                best = (lag, correlation);
            }
        }
    }
    let reliable = best.1 >= 0.18;
    let mut beats: Vec<Onset> = Vec::new();
    if reliable {
        // Collapse nearby attacks; keep the strongest measured attack in each interval.
        for onset in &onsets {
            if let Some(last) = beats.last_mut() {
                if onset.time_ms - last.time_ms < (best.0 * 7) as u32 {
                    if onset.strength > last.strength {
                        *last = onset.clone();
                    }
                    continue;
                }
            }
            beats.push(onset.clone());
        }
    }
    Ok(AudioAnalysis {
        silences,
        removal_ranges,
        beat_map: BeatMap {
            bpm: reliable.then(|| 6000. / best.0 as f64),
            confidence: best.1.clamp(0., 1.),
            beats,
            downbeats: vec![],
            onsets,
            energy_curve: rms
                .chunks(10)
                .enumerate()
                .map(|(i, s)| EnergyPoint {
                    time_ms: (i * 100) as u32,
                    rms_db: db((s.iter().map(|v| v * v).sum::<f64>() / s.len() as f64).sqrt()),
                })
                .collect(),
            method:
                "Amplitude-flux peaks / autocorrelation; approximate tempo, no downbeat detector"
                    .into(),
        },
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_actual_clicks_and_silence_without_inventing_beats() {
        let cancel = AtomicBool::new(false);
        let settings = Settings::default();
        let silent = samples_analysis(&vec![0.; RATE * 4], &settings, &cancel).unwrap();
        assert_eq!(silent.silences[0].end_ms, 4000);
        assert!(silent.beat_map.bpm.is_none());
        assert!(silent.beat_map.beats.is_empty());
        let mut samples = vec![0.; RATE * 10];
        for pulse in 0..16 {
            for i in 0..160 {
                samples[RATE + pulse * RATE / 2 + i] = 0.8 * (i as f64 * 0.3).sin();
            }
        }
        let result = samples_analysis(&samples, &settings, &cancel).unwrap();
        assert!((result.beat_map.bpm.unwrap() - 120.).abs() < 2.);
        assert_eq!(result.beat_map.beats.len(), 16);
        assert_eq!(result.beat_map.beats[0].time_ms, 1000);
        assert!(result.silences.iter().any(|r| r.end_ms == 1000));
        assert_eq!(result.removal_ranges[0].start_ms, 100);
    }
}
