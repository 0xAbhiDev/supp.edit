//! Text already present in raw footage (burned-in labels, captions, signs), measured only on the
//! candidate source intervals the planner is considering — never the whole clip. Each interval
//! is sampled at three frames; each frame is read by local OCR on the plain picture and on its
//! inverse (dark ink); lines are then tracked across the frames into regions with persistence
//! and position drift. What the regions mean (an overlay or scene text, equivalent to a
//! reference title or unrelated) is decided by the caller with its own evidence.
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::atomic::AtomicBool};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Interval {
    pub start_ms: u32,
    pub end_ms: u32,
}

/// One text region within one requested interval. Coordinates are fractions of the source frame
/// (top-left origin, before any crop or framing).
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RawTextRegion {
    pub interval: usize,
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    /// Frames the region was read in, of the frames sampled.
    pub frames: u32,
    pub sampled: u32,
    /// Largest movement of the region's centre between samples (frame fractions).
    pub drift: f32,
    /// 0–1: persistence across samples and plausibility of the reading.
    pub confidence: f32,
    /// Read in most samples at a steady position: part of the source pixels, not passing text.
    pub likely_burned_in: bool,
}

/// Samples per interval, at 20%, 50% and 80% of it.
pub const SAMPLES: [f32; 3] = [0.2, 0.5, 0.8];

fn normalized(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
}

/// How plausible a reading is as text: mostly letters and digits, at least two of them.
fn plausibility(text: &str) -> f32 {
    let chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.len() < 2 {
        return 0.;
    }
    let alnum = chars.iter().filter(|c| c.is_alphanumeric()).count() as f32;
    (alnum / chars.len() as f32).min(1.)
}

/// One frame's OCR lines: (text, x, y, width, height) in frame fractions.
pub type Line = (String, f32, f32, f32, f32);

/// Track lines read in the samples of one interval into regions. Pure: tested without OCR.
pub fn merge(interval: usize, samples: &[Vec<Line>]) -> Vec<RawTextRegion> {
    struct Track {
        text: String,
        boxes: Vec<(f32, f32, f32, f32)>,
    }
    let mut tracks: Vec<Track> = vec![];
    for lines in samples {
        let mut used = vec![false; tracks.len()];
        for (text, x, y, w, h) in lines {
            let key = normalized(text);
            if key.is_empty() {
                continue;
            }
            let (cx, cy) = (x + w / 2., y + h / 2.);
            let found = tracks.iter().enumerate().position(|(i, t)| {
                if used.get(i).copied().unwrap_or(false) {
                    return false;
                }
                let &(tx, ty, tw, th) = t.boxes.last().unwrap();
                let near = (cx - (tx + tw / 2.)).abs() < 0.5 * tw.max(*w).max(0.05) && (cy - (ty + th / 2.)).abs() < th.max(*h).max(0.03);
                // Readings of one line differ in spacing ("INCLINEPRESS", "INCLINE PRESS").
                near && (t.text.replace(' ', "") == key.replace(' ', "") || overlap_words(&t.text, &key))
            });
            match found {
                Some(i) => {
                    tracks[i].boxes.push((*x, *y, *w, *h));
                    if key.len() > tracks[i].text.len() {
                        tracks[i].text = key;
                    }
                    used[i] = true;
                }
                None => {
                    tracks.push(Track { text: key, boxes: vec![(*x, *y, *w, *h)] });
                    used.push(true);
                }
            }
        }
    }
    let sampled = samples.len() as u32;
    tracks
        .into_iter()
        .map(|t| {
            let n = t.boxes.len() as f32;
            let (mut x, mut y, mut r, mut b) = (1f32, 1f32, 0f32, 0f32);
            for &(bx, by, bw, bh) in &t.boxes {
                x = x.min(bx);
                y = y.min(by);
                r = r.max(bx + bw);
                b = b.max(by + bh);
            }
            let centres: Vec<(f32, f32)> = t.boxes.iter().map(|&(bx, by, bw, bh)| (bx + bw / 2., by + bh / 2.)).collect();
            let drift = centres
                .iter()
                .flat_map(|a| centres.iter().map(move |c| ((a.0 - c.0).powi(2) + (a.1 - c.1).powi(2)).sqrt()))
                .fold(0f32, f32::max);
            let persistence = n / sampled.max(1) as f32;
            let confidence = (0.6 * persistence + 0.4 * plausibility(&t.text)).min(1.);
            let frames = t.boxes.len() as u32;
            RawTextRegion {
                interval,
                likely_burned_in: frames >= 2 && 2 * frames >= sampled && drift <= 0.03 && confidence >= 0.5,
                text: t.text,
                x,
                y,
                width: r - x,
                height: b - y,
                frames,
                sampled,
                drift: (drift * 1000.).round() / 1000.,
                confidence: (confidence * 100.).round() / 100.,
            }
        })
        .collect()
}

fn overlap_words(a: &str, b: &str) -> bool {
    let wa: Vec<&str> = a.split(' ').filter(|w| w.len() >= 3).collect();
    b.split(' ').filter(|w| w.len() >= 3).any(|w| wa.contains(&w))
}

#[cfg(windows)]
pub fn run(source: &Path, intervals: &[Interval], cancel: &AtomicBool) -> Result<Vec<RawTextRegion>, String> {
    use windows::{
        Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine,
        Storage::Streams::DataWriter,
    };
    let ocr = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| format!("Local OCR language is unavailable: {e}"))?;
    let asset = crate::inspect(source, "source-text".into())?;
    if asset.kind != "video" {
        return Err("Source text analysis requires video".into());
    }
    let scale = (1280. / f64::from(asset.width.max(asset.height))).min(2.);
    let w = (f64::from(asset.width) * scale).round().max(1.) as usize;
    let h = (f64::from(asset.height) * scale).round().max(1.) as usize;
    let mut out = vec![];
    for (index, iv) in intervals.iter().enumerate().take(256) {
        let mut samples: Vec<Vec<Line>> = vec![];
        for f in SAMPLES {
            super::check(cancel)?;
            let at = f64::from(iv.start_ms) + f64::from(iv.end_ms.saturating_sub(iv.start_ms)) * f64::from(f);
            let gray = super::execute(
                crate::command("ffmpeg")
                    .args(["-v", "error", "-nostdin", "-threads", "2", "-protocol_whitelist", "file,pipe", "-ss", &format!("{:.3}", at / 1000.), "-i"])
                    .arg(source)
                    .args(["-frames:v", "1", "-map", "0:v:0", "-an", "-vf", &format!("scale={w}:{h}"), "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"]),
                cancel,
                w * h,
            )?;
            if gray.len() < w * h {
                continue;
            }
            let mut lines: Vec<Line> = vec![];
            for invert in [false, true] {
                let mut read = || -> windows::core::Result<()> {
                    let writer = DataWriter::new()?;
                    let pixels: Vec<u8> = if invert { gray[..w * h].iter().map(|v| 255 - v).collect() } else { gray[..w * h].to_vec() };
                    writer.WriteBytes(&pixels)?;
                    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&writer.DetachBuffer()?, BitmapPixelFormat::Gray8, w as i32, h as i32)?;
                    let result = ocr.RecognizeAsync(&bitmap)?.get()?;
                    for line in result.Lines()? {
                        let text = line.Text()?.to_string();
                        if text.trim().is_empty() || text.chars().count() > 120 {
                            continue;
                        }
                        let (mut x, mut y, mut r, mut b) = (w as f32, h as f32, 0f32, 0f32);
                        for word in line.Words()? {
                            let rect = word.BoundingRect()?;
                            x = x.min(rect.X);
                            y = y.min(rect.Y);
                            r = r.max(rect.X + rect.Width);
                            b = b.max(rect.Y + rect.Height);
                        }
                        if r <= x || b <= y {
                            continue;
                        }
                        let candidate = (text, x / w as f32, y / h as f32, (r - x) / w as f32, (b - y) / h as f32);
                        // The two passes often read the same line: keep one.
                        if !lines.iter().any(|l| normalized(&l.0) == normalized(&candidate.0) && (l.1 - candidate.1).abs() < 0.02 && (l.2 - candidate.2).abs() < 0.02) {
                            lines.push(candidate);
                        }
                    }
                    Ok(())
                };
                read().map_err(|e| format!("Local OCR failed: {e}"))?;
            }
            samples.push(lines);
        }
        out.extend(merge(index, &samples));
    }
    Ok(out)
}
#[cfg(not(windows))]
pub fn run(_: &Path, _: &[Interval], _: &AtomicBool) -> Result<Vec<RawTextRegion>, String> {
    Err("Source text analysis uses the Windows OCR engine".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn steady_lines_become_burned_in_regions_and_passing_text_does_not() {
        let label = |dx: f32| ("BENCH PRESS".to_string(), 0.6 + dx, 0.7, 0.3, 0.08);
        let sign = |dx: f32| ("OPEN".to_string(), 0.1 + dx, 0.2, 0.1, 0.05);
        let samples = vec![vec![label(0.), sign(0.)], vec![label(0.002), sign(0.15)], vec![label(0.), sign(0.3)]];
        let regions = merge(4, &samples);
        let label = regions.iter().find(|r| r.text == "BENCH PRESS").unwrap();
        assert!(label.likely_burned_in && label.frames == 3 && label.interval == 4);
        // A sign that slides across the picture (scene text under a moving camera) is not
        // tracked as one steady region.
        assert!(regions.iter().filter(|r| r.text == "OPEN").all(|r| !r.likely_burned_in));
        // One stray reading is not burned-in text.
        let once = merge(0, &[vec![("ab".to_string(), 0.4, 0.4, 0.05, 0.03)], vec![], vec![]]);
        assert!(!once[0].likely_burned_in);
    }
}
