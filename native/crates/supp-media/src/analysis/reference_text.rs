//! Measure transient text and its foreground treatment on the local device.
use crate::models::Progress;
use serde::Serialize;
use std::{path::Path, sync::atomic::AtomicBool};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InkBox {
    rows: Vec<u32>,
    time_ms: u32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}
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
    content: String,
    foreground: String,
    accent: Option<String>,
    accent_word: Option<u32>,
    reveal_offset_ms: Option<u32>,
    width_change: f32,
    vertical_change: f32,
    observations: u32,
    pass_agreements: u32,
    glyph_rows: Vec<u32>,
    geometry: Vec<InkBox>,
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
    // Small messaging-app encodes need enough pixels per glyph for local OCR.
    let scale = (1080. / f64::from(asset.width.max(asset.height))).min(2.);
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
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]),
            cancel,
            w * h * 3 * (4 * hz + 1),
        )?;
        for (i, frame) in frames.chunks_exact(w * h * 3).enumerate() {
            super::check(cancel)?;
            let at = (start * 1000) as u32 + i as u32 * step_ms;
            // Separate passes retain bright lettering and recover colored or dark ink.
            let mut observed: Vec<(f32, f32, f32, f32, usize)> = vec![];
            // A red or rose title may be darker than its background, with only a
            // small chroma difference. The all-hues pass also keeps a strongly
            // graded background. Separate complementary inks in those scenes.
            // A color grade can tint the whole scene but spare the overlaid display
            // type. Find a dominant channel from non-black, non-white scene pixels.
            // Select ink neutral to (or opposing) that cast at two recognition scales.
            let mut channels = [0i64; 3];
            let mut count = 0i64;
            for rgb in frame.chunks_exact(3).step_by(17) {
                if *rgb.iter().max().unwrap() > 32 && *rgb.iter().min().unwrap() < 210 {
                    for n in 0..3 {
                        channels[n] += i64::from(rgb[n]);
                    }
                    count += 1;
                }
            }
            let mut rank = [0usize, 1, 2];
            rank.sort_by_key(|&i| -channels[i]);
            let cast = channels[rank[0]] - channels[rank[1]] > 4 * count;
            for pass in [0u8, 1, 2, 7, 8, 3, 4, 5, 6] {
                if pass >= 7 && !cast {
                    continue;
                }
                let mut recognize = || -> windows::core::Result<()> {
                    let writer = DataWriter::new()?;
                    // Isolate bright overlay glyphs from textured video before recognition.
                    let ink: Vec<_> = frame
                        .chunks_exact(3)
                        .map(|rgb| {
                            let luma = (54 * u32::from(rgb[0])
                                + 183 * u32::from(rgb[1])
                                + 19 * u32::from(rgb[2]))
                                / 256;
                            match pass {
                                0 => {
                                    if luma >= 192 {
                                        0
                                    } else {
                                        255
                                    }
                                }
                                1 => {
                                    if rgb.iter().max().unwrap() - rgb.iter().min().unwrap() >= 60
                                        && *rgb.iter().max().unwrap() >= 100
                                    {
                                        0
                                    } else {
                                        255
                                    }
                                }
                                2 => 255 - luma as u8,
                                7 | 8 => {
                                    let rgb =
                                        [i32::from(rgb[0]), i32::from(rgb[1]), i32::from(rgb[2])];
                                    let neutral = match rank[0] {
                                        1 => 10 * rgb[1] - 7 * rgb[0] - 3 * rgb[2],
                                        0 => 10 * rgb[0] - 7 * rgb[1] - 3 * rgb[2],
                                        _ => 10 * rgb[2] - 7 * rgb[1] - 3 * rgb[0],
                                    };
                                    if luma >= 56 && neutral < 10 {
                                        0
                                    } else {
                                        255
                                    }
                                }
                                _ => {
                                    let [r, g, b] =
                                        [i16::from(rgb[0]), i16::from(rgb[1]), i16::from(rgb[2])];
                                    let sign = if pass % 2 == 1 { 1 } else { -1 };
                                    if sign * (r - g) > 6 && sign * (r + b - 2 * g) > 10 {
                                        0
                                    } else {
                                        255
                                    }
                                }
                            }
                        })
                        .collect();
                    if pass >= 3 {
                        let marked = ink.iter().filter(|&&p| p == 0).count();
                        if marked < w * h / 500 || marked > w * h / 3 {
                            return Ok(());
                        }
                    }
                    // Large display titles and small labels need different OCR scales.
                    // At half scale, integrate a 2x2 patch to join fine letter strokes.
                    let stride = if [5, 6, 8].contains(&pass) { 2 } else { 1 };
                    let (ow, oh) = (w / stride, h / stride);
                    if stride == 2 {
                        let mut small = Vec::with_capacity(ow * oh);
                        for y in 0..oh {
                            for x in 0..ow {
                                let i = 2 * y * w + 2 * x;
                                small.push(
                                    ink[i].min(ink[i + 1]).min(ink[i + w]).min(ink[i + w + 1]),
                                );
                            }
                        }
                        writer.WriteBytes(&small)?;
                    } else {
                        writer.WriteBytes(&ink)?;
                    }
                    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
                        &writer.DetachBuffer()?,
                        BitmapPixelFormat::Gray8,
                        ow as i32,
                        oh as i32,
                    )?;
                    let result = ocr.RecognizeAsync(&bitmap)?.get()?;
                    for line in result.Lines()? {
                        let words = line.Words()?;
                        let count = words.Size()?;
                        if count == 0 || count > 20 {
                            continue;
                        }
                        let (mut x, mut y, mut r, mut b) = (w as f32, h as f32, 0f32, 0f32);
                        let mut neutral = [0u64; 3];
                        let mut neutral_count = 0u64;
                        let mut strongest: Option<(usize, f32, [u64; 3], u64)> = None;
                        for (index, word) in words.into_iter().enumerate() {
                            let mut rect = word.BoundingRect()?;
                            rect.X *= stride as f32;
                            rect.Y *= stride as f32;
                            rect.Width *= stride as f32;
                            rect.Height *= stride as f32;
                            let mut accent = [0u64; 3];
                            let mut n = 0u64;
                            let mut bright = 0u64;
                            for yy in (rect.Y.max(0.) as usize)
                                ..((rect.Y + rect.Height).ceil() as usize).min(h)
                            {
                                for xx in (rect.X.max(0.) as usize)
                                    ..((rect.X + rect.Width).ceil() as usize).min(w)
                                {
                                    let off = yy * w + xx;
                                    if ink[off] > 96 {
                                        continue;
                                    }
                                    bright += 1;
                                    let p = &frame[off * 3..off * 3 + 3];
                                    if p.iter().max().unwrap() - p.iter().min().unwrap() > 48 {
                                        for k in 0..3 {
                                            accent[k] += u64::from(p[k]);
                                        }
                                        n += 1;
                                    } else {
                                        for k in 0..3 {
                                            neutral[k] += u64::from(p[k]);
                                        }
                                        neutral_count += 1;
                                    }
                                }
                            }
                            let fraction = n as f32 / bright.max(1) as f32;
                            if n >= 8
                                && fraction > 0.22
                                && strongest.as_ref().is_none_or(|s| fraction > s.1)
                            {
                                strongest = Some((index, fraction, accent, n));
                            }
                            x = x.min(rect.X);
                            y = y.min(rect.Y);
                            r = r.max(rect.X + rect.Width);
                            b = b.max(rect.Y + rect.Height);
                        }
                        let name = line.Text()?.to_string();
                        if name.trim().is_empty() || name.chars().count() > 120 {
                            continue;
                        }
                        let hex = |p: [u64; 3], n: u64| {
                            format!("#{:02X}{:02X}{:02X}", p[0] / n, p[1] / n, p[2] / n)
                        };
                        let mut metric = TextAppearance {
                            start_ms: at,
                            end_ms: at + step_ms,
                            x: x / w as f32,
                            y: y / h as f32,
                            width: (r - x) / w as f32,
                            height: (b - y) / h as f32,
                            words: count,
                            content: name.clone(),
                            foreground: if neutral_count > 0 {
                                hex(neutral, neutral_count)
                            } else {
                                String::from("#FFFFFF")
                            },
                            accent: strongest.map(|(_, _, p, n)| hex(p, n)),
                            accent_word: strongest.map(|s| s.0 as u32),
                            reveal_offset_ms: None,
                            width_change: 0.,
                            vertical_change: 0.,
                            observations: 1,
                            pass_agreements: 0,
                            glyph_rows: vec![],
                            geometry: vec![InkBox {
                                rows: vec![],
                                time_ms: at,
                                x: x / w as f32,
                                y: y / h as f32,
                                width: (r - x) / w as f32,
                                height: (b - y) / h as f32,
                            }],
                        };
                        if metric.width < 0.022 || metric.height < 0.011 || metric.height > 0.45 {
                            continue;
                        }
                        // Deduplicate observations of the same spatial line in this frame.
                        if let Some((_, _, _, _, index)) =
                            observed.iter().find(|&&(ox, oy, ow, oh, _)| {
                                let intersection = (r.min(ox + ow) - x.max(ox)).max(0.)
                                    * (b.min(oy + oh) - y.max(oy)).max(0.);
                                intersection / (((r - x) * (b - y)).min(ow * oh)).max(1.) > 0.7
                            })
                        {
                            if runs[*index].0.eq_ignore_ascii_case(&name) {
                                runs[*index].1.pass_agreements += 1;
                            }
                            continue;
                        }
                        // A compact binary silhouette of the visible ink supports local font comparison.
                        for row in 0..16 {
                            let mut bits = 0u32;
                            for col in 0..32 {
                                let yy =
                                    ((y + (row as f32 + 0.5) * (b - y) / 16.) as usize).min(h - 1);
                                let xx =
                                    ((x + (col as f32 + 0.5) * (r - x) / 32.) as usize).min(w - 1);
                                if ink[yy * w + xx] < 112 {
                                    bits |= 1 << col;
                                }
                            }
                            metric.glyph_rows.push(bits);
                        }
                        metric.geometry[0].rows.clone_from(&metric.glyph_rows);
                        if let Some(index) = runs.iter().rposition(|(s, t)| {
                            t.end_ms >= at.saturating_sub(step_ms)
                                && t.end_ms <= at + step_ms
                                && (metric.y - t.y).abs() < 0.06
                                && (metric.x - t.x).abs() < 0.1
                                && (s.eq_ignore_ascii_case(&name)
                                    || name
                                        .strip_prefix(s.as_str())
                                        .is_some_and(|tail| tail.starts_with(' ')))
                        }) {
                            observed.push((x, y, r - x, b - y, index));
                            let (prior, old) = &mut runs[index];
                            old.observations += 1;
                            let ink_count =
                                |rows: &[u32]| rows.iter().map(|r| r.count_ones()).sum::<u32>();
                            let count_ink = ink_count(&metric.glyph_rows);
                            if count_ink > ink_count(&old.glyph_rows) && count_ink < 440 {
                                old.glyph_rows.clone_from(&metric.glyph_rows);
                            }
                            if !prior.eq_ignore_ascii_case(&name) {
                                old.reveal_offset_ms = Some(at - old.start_ms);
                                prior.clone_from(&name);
                                old.content.clone_from(&name);
                                old.words = count;
                                old.observations = 1;
                                old.pass_agreements = 0;
                                old.glyph_rows.clone_from(&metric.glyph_rows);
                                // The preceding box only enclosed the prefix. Size the completed
                                // line from its own ink; retain onset separately for word build.
                                old.geometry.clear();
                                old.x = metric.x;
                                old.y = metric.y;
                                old.width = metric.width;
                                old.height = metric.height;
                                old.accent = metric.accent;
                                old.accent_word = metric.accent_word;
                            }
                            old.end_ms = at + step_ms;
                            if old.geometry.len() == 128 {
                                old.geometry = old.geometry.iter().step_by(2).cloned().collect();
                            }
                            if old.geometry.last().is_none_or(|b| b.time_ms != at) {
                                old.geometry.append(&mut metric.geometry);
                            }
                            old.width_change = (metric.width / old.width - 1.).clamp(-1., 2.);
                            old.vertical_change = metric.y - old.y;
                        } else {
                            observed.push((x, y, r - x, b - y, runs.len()));
                            runs.push((name, metric))
                        }
                    }
                    Ok(())
                };
                recognize().map_err(|e| e.to_string())?;
            }
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
