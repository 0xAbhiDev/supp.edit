//! Extract the geometry and timing of transient text. Recognition strings never leave the worker.
use crate::models::Progress;
use serde::Serialize;
use std::{path::Path, sync::atomic::AtomicBool};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAppearance {
    start_ms: u32,
    end_ms: u32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    words: u32,
}
#[cfg(windows)]
pub fn run(
    source: &Path,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<Vec<TextAppearance>, String> {
    use windows::{
        Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine,
        Storage::Streams::DataWriter,
    };
    let ocr = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("Local OCR language is unavailable: {e}"))?;
    let asset = crate::inspect(source, "reference-text".into())?;
    if asset.kind != "video" {
        return Err("Text analysis requires video".into());
    }
    let scale = (1080. / f64::from(asset.width.max(asset.height))).min(1.);
    let w = (f64::from(asset.width) * scale).round().max(1.) as usize;
    let h = (f64::from(asset.height) * scale).round().max(1.) as usize;
    let total = asset.duration.min(300.).ceil() as usize;
    let hz = if total <= 60 { 8 } else { 4 };
    let step_ms = 1000 / hz as u32;
    let mut runs: Vec<(String, TextAppearance)> = vec![];
    for start in (0..total).step_by(4) {
        super::check(cancel)?;
        let frames = super::execute(
            crate::command("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-nostdin",
                    "-threads",
                    "2",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-ss",
                    &start.to_string(),
                    "-i",
                ])
                .arg(source)
                .args([
                    "-t",
                    "4",
                    "-map",
                    "0:v:0",
                    "-an",
                    "-vf",
                    &format!("fps={hz},scale={w}:{h}"),
                    "-pix_fmt",
                    "gray",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]),
            cancel,
            w * h * (4 * hz + 1),
        )?;
        for (i, frame) in frames.chunks_exact(w * h).enumerate() {
            super::check(cancel)?;
            let at = (start * 1000) as u32 + i as u32 * step_ms;
            let mut recognize = || -> windows::core::Result<()> {
                let writer = DataWriter::new()?;
                // Isolate bright overlay glyphs from textured video before recognition.
                let ink: Vec<_> = frame
                    .iter()
                    .map(|&v| if v >= 192 { 0 } else { 255 })
                    .collect();
                writer.WriteBytes(&ink)?;
                let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
                    &writer.DetachBuffer()?,
                    BitmapPixelFormat::Gray8,
                    w as i32,
                    h as i32,
                )?;
                let result = ocr.RecognizeAsync(&bitmap)?.get()?;
                for line in result.Lines()? {
                    let words = line.Words()?;
                    let count = words.Size()?;
                    if count == 0 || count > 20 {
                        continue;
                    }
                    let (mut x, mut y, mut r, mut b) = (w as f32, h as f32, 0f32, 0f32);
                    for word in words {
                        let rect = word.BoundingRect()?;
                        x = x.min(rect.X);
                        y = y.min(rect.Y);
                        r = r.max(rect.X + rect.Width);
                        b = b.max(rect.Y + rect.Height);
                    }
                    let name = line.Text()?.to_string().to_lowercase();
                    let metric = TextAppearance {
                        start_ms: at,
                        end_ms: at + step_ms,
                        x: x / w as f32,
                        y: y / h as f32,
                        width: (r - x) / w as f32,
                        height: (b - y) / h as f32,
                        words: count,
                    };
                    if metric.width < 0.08 || metric.height < 0.011 || metric.height > 0.25 {
                        continue;
                    }
                    if let Some((_, old)) = runs.iter_mut().rev().find(|(s, t)| {
                        *s == name && t.end_ms == at && (metric.y - t.y).abs() < 0.12
                    }) {
                        old.end_ms = at + step_ms
                    } else {
                        runs.push((name, metric))
                    }
                }
                Ok(())
            };
            recognize().map_err(|e| e.to_string())?;
        }
        report(Progress {
            completed: (start + 4).min(total) as u64,
            total: total as u64,
            unit: "seconds sampled for text",
        });
    }
    let end = (asset.duration.min(300.) * 1000.) as u32;
    Ok(runs
        .into_iter()
        .map(|(_, mut t)| {
            t.end_ms = t.end_ms.min(end);
            t
        })
        .filter(|t| t.end_ms >= t.start_ms + 2 * step_ms && t.end_ms - t.start_ms < end * 3 / 4)
        .take(512)
        .collect())
}
#[cfg(not(windows))]
pub fn run(_: &Path, _: &AtomicBool, _: impl Fn(Progress)) -> Result<Vec<TextAppearance>, String> {
    Err("Windows OCR is unavailable".into())
}
