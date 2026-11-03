//! Offline stereo resampling against the same source-time curve as video.
//! Pitch changes with speed. No pitch-preserving speech enhancement is claimed.
use std::{
    fs,
    io::{BufWriter, Write},
    path::Path,
    process::Stdio,
};
use supp_project::Clip;
const SAMPLE_RATE: f64 = 48000.;
pub fn render(
    path: &Path,
    clip: &Clip,
    local_start: f64,
    rate: f64,
    duration: f64,
) -> Result<tempfile::TempPath, String> {
    let source_start = clip.source_frame(local_start) / rate;
    let source_end = clip.source_frame(local_start + duration * rate) / rate;
    if duration > 300. || source_end - source_start > 300. {
        return Err("Speed-remapped audio exceeds 5 minutes".into());
    }
    let decoded = tempfile::Builder::new()
        .prefix("supp-source-audio-")
        .suffix(".f32")
        .tempfile()
        .map_err(|e| e.to_string())?
        .into_temp_path();
    let output = supp_media::command("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
        ])
        .arg(path)
        // Decode before seeking: input seeking at zero can discard AAC priming twice.
        .args([
            "-ss",
            &format!("{source_start:.9}"),
            "-t",
            &format!("{:.9}", source_end - source_start + 0.002),
        ])
        .args(["-vn", "-ar", "48000", "-ac", "2", "-f", "f32le"])
        .arg(&decoded)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Cannot decode speed-remapped audio: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if fs::metadata(&decoded).map_err(|e| e.to_string())?.len() > 116_000_000 {
        return Err("Decoded ramp audio exceeds memory budget".into());
    }
    let bytes = fs::read(&decoded).map_err(|e| e.to_string())?;
    if bytes.len() < 8 || !bytes.len().is_multiple_of(8) {
        return Err("Source has no decodable stereo audio".into());
    }
    let file = tempfile::Builder::new()
        .prefix("supp-ramped-audio-")
        .suffix(".f32")
        .tempfile()
        .map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(file.as_file());
    resample(&bytes, clip, local_start, rate, duration, &mut writer)?;
    writer.flush().map_err(|e| e.to_string())?;
    drop(writer);
    Ok(file.into_temp_path())
}
fn resample(
    bytes: &[u8],
    clip: &Clip,
    local_start: f64,
    rate: f64,
    duration: f64,
    writer: &mut impl Write,
) -> Result<(), String> {
    let count = (duration * SAMPLE_RATE).round() as usize;
    let source_start = clip.source_frame(local_start) / rate;
    let source_count = bytes.len() / 8;
    if source_count == 0 {
        return Err("Decoded audio is empty".into());
    }
    let mut gain_keys = clip
        .keyframes
        .extra
        .get("gain")
        .cloned()
        .unwrap_or_default();
    gain_keys.sort_by_key(|k| k.frame);
    let gain = |i: usize| {
        let db = supp_project::animation::evaluate(
            &gain_keys,
            local_start + i as f64 / SAMPLE_RATE * rate,
            clip.gain,
        )
        .clamp(-60., 12.);
        10_f64.powf((db - clip.gain) / 20.) as f32
    };
    let sample = |frame: usize, channel: usize| -> f32 {
        let at = (frame.min(source_count - 1) * 2 + channel) * 4;
        f32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
    };
    // 1ms source-position knots bound work independently of key count, with continuous interpolation.
    let position = |i: usize| {
        (clip.source_frame(local_start + i as f64 / SAMPLE_RATE * rate) / rate - source_start)
            * SAMPLE_RATE
    };
    for begin in (0..count).step_by(48) {
        let end = (begin + 48).min(count);
        let a = position(begin);
        let b = position(end);
        let (ga, gb) = (gain(begin), gain(end));
        for i in begin..end {
            let at = (a + (b - a) * (i - begin) as f64 / (end - begin) as f64).max(0.);
            let index = at.floor() as usize;
            let fraction = (at - index as f64) as f32;
            for channel in 0..2 {
                let x = sample(index, channel);
                let y = sample(index + 1, channel);
                let envelope = ga + (gb - ga) * (i - begin) as f32 / (end - begin) as f32;
                let value = (x + (y - x) * fraction) * envelope;
                if !value.is_finite() {
                    return Err("Nonfinite decoded audio sample".into());
                }
                writer
                    .write_all(&value.to_le_bytes())
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automated_gain_is_evaluated_in_timeline_time_without_double_base_gain() {
        let mut p: supp_project::Project = serde_json::from_str(include_str!(
            "../../supp-project/tests/fixtures/compositor-v3.supp"
        ))
        .unwrap();
        let clip = &mut p.clips[0];
        clip.source_in = 0;
        clip.gain = -6.;
        clip.keyframes.extra.insert(
            "gain".into(),
            serde_json::from_value(serde_json::json!([
                {"frame":0,"value":-20.,"easing":"linear"},{"frame":30,"value":0.,"easing":"linear"}
            ]))
            .unwrap(),
        );
        let bytes: Vec<u8> = (0..48000 * 2).flat_map(|_| 1_f32.to_le_bytes()).collect();
        let mut out = Vec::new();
        resample(&bytes, clip, 0., 30., 1., &mut out).unwrap();
        let sample = f32::from_le_bytes(out[24000 * 8..24000 * 8 + 4].try_into().unwrap()) as f64;
        assert!((sample * 10_f64.powf(clip.gain / 20.) - 10_f64.powf(-10. / 20.)).abs() < 1e-6);
        let mut trimmed = Vec::new();
        resample(&bytes, clip, 15., 30., 0.5, &mut trimmed).unwrap();
        let first = f32::from_le_bytes(trimmed[0..4].try_into().unwrap()) as f64;
        assert!((first - sample).abs() < 1e-6);
    }
    #[test]
    fn constant_speed_audio_matches_video_source_positions() {
        let mut p: supp_project::Project = serde_json::from_str(include_str!(
            "../../supp-project/tests/fixtures/compositor-v3.supp"
        ))
        .unwrap();
        let clip = &mut p.clips[0];
        clip.source_in = 0;
        clip.time_remap=Some(serde_json::from_value(serde_json::json!({"sourceOffset":0.,"keys":[{"frame":0,"speed":2.,"easing":"smooth"}]})).unwrap());
        let bytes: Vec<u8> = (0..9600)
            .flat_map(|i| {
                [i as f32 / 9600., -(i as f32) / 9600.]
                    .into_iter()
                    .flat_map(f32::to_le_bytes)
            })
            .collect();
        let mut out = Vec::new();
        resample(&bytes, clip, 0., 30., 0.1, &mut out).unwrap();
        assert_eq!(out.len(), 4800 * 8);
        let value = f32::from_le_bytes(out[2400 * 8..2400 * 8 + 4].try_into().unwrap());
        assert!((value - 0.5).abs() < 1e-6);
        let right = f32::from_le_bytes(out[2400 * 8 + 4..2400 * 8 + 8].try_into().unwrap());
        assert!((right + 0.5).abs() < 1e-6);
    }
}
