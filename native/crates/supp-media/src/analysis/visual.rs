//! Dense, low-resolution measurements for reference boundaries and shot appearance.
use super::{check, color, execute};
use crate::models::Progress;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::atomic::AtomicBool};

const WIDTH: usize = 96;
const HEIGHT: usize = 54;
const PIXELS: usize = WIDTH * HEIGHT;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisualFrame {
    pub time_ms: u32,
    pub luma: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub temperature: Option<f64>,
    pub sharpness: f64,
    pub change: f64,
    pub white_fraction: f64,
    pub black_fraction: f64,
    pub layout: [f64; 16],
    pub shadow_rgb: [u8; 3],
    pub highlight_rgb: [u8; 3],
    pub flow: Option<VisualFlow>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisualFlow {
    pan_x: f64,
    pan_y: f64,
    expansion: f64,
    confidence: f64,
}

fn measure(rgb: &[u8], previous: Option<&[u8]>, time_ms: u32) -> VisualFrame {
    let (luma, contrast, saturation, temperature, _) = color::measure(rgb);
    let gray: Vec<f64> = rgb
        .chunks_exact(3)
        .map(|p| {
            (0.2126 * f64::from(p[0]) + 0.7152 * f64::from(p[1]) + 0.0722 * f64::from(p[2])) / 255.
        })
        .collect();
    let mut energy = 0.;
    let mut layout = [0.; 16];
    let mut counts = [0u32; 16];
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            let i = y * WIDTH + x;
            let cell = (y * 4 / HEIGHT) * 4 + x * 4 / WIDTH;
            layout[cell] += gray[i];
            counts[cell] += 1;
            if x > 0 && y > 0 && x + 1 < WIDTH && y + 1 < HEIGHT {
                let laplacian =
                    4. * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - WIDTH] - gray[i + WIDTH];
                energy += laplacian * laplacian;
            }
        }
    }
    for (value, count) in layout.iter_mut().zip(counts) {
        *value /= f64::from(count);
    }
    // Average the darkest and lightest deciles to estimate a two-color palette.
    // Luminance bins bound memory and avoid sorting thousands of pixels per frame.
    let mut bins = [[0u32; 4]; 64];
    for (pixel, &luma) in rgb.chunks_exact(3).zip(&gray) {
        let bin = &mut bins[((luma * 64.) as usize).min(63)];
        bin[3] += 1;
        for c in 0..3 {
            bin[c] += u32::from(pixel[c]);
        }
    }
    let tail = |bright: bool| {
        let count = (gray.len() / 10).max(1) as u32;
        let mut left = count;
        let mut sum = [0.; 3];
        for i in 0..64 {
            let b = bins[if bright { 63 - i } else { i }];
            if b[3] == 0 {
                continue;
            }
            let take = left.min(b[3]);
            for c in 0..3 {
                sum[c] += f64::from(b[c]) * f64::from(take) / f64::from(b[3]);
            }
            left -= take;
            if left == 0 {
                break;
            }
        }
        sum.map(|s| (s / f64::from(count)).round() as u8)
    };
    VisualFrame {
        shadow_rgb: tail(false),
        highlight_rgb: tail(true),
        time_ms,
        flow: previous.map(|prior| {
            let to_gray = |pixels: &[u8]| {
                pixels
                    .chunks_exact(3)
                    .map(|p| {
                        (0.2126 * f64::from(p[0])
                            + 0.7152 * f64::from(p[1])
                            + 0.0722 * f64::from(p[2]))
                        .round() as u8
                    })
                    .collect::<Vec<_>>()
            };
            let flow = super::reference::describe(&to_gray(prior), &to_gray(rgb), time_ms);
            VisualFlow {
                pan_x: flow.pan_x,
                pan_y: flow.pan_y,
                expansion: flow.expansion,
                confidence: flow.confidence,
            }
        }),
        luma,
        contrast,
        saturation,
        temperature,
        sharpness: (energy / ((WIDTH - 2) * (HEIGHT - 2)) as f64).sqrt(),
        change: previous
            .map(|p| {
                rgb.iter()
                    .zip(p)
                    .map(|(a, b)| f64::from(a.abs_diff(*b)))
                    .sum::<f64>()
                    / (rgb.len() as f64 * 255.)
            })
            .unwrap_or(0.),
        white_fraction: gray.iter().filter(|&&v| v > 0.94).count() as f64 / PIXELS as f64,
        black_fraction: gray.iter().filter(|&&v| v < 0.035).count() as f64 / PIXELS as f64,
        layout,
    }
}

pub fn run(
    source: &Path,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<Vec<VisualFrame>, String> {
    let source = crate::validate_path(source)?;
    let asset = crate::inspect(&source, "reference-visual".into())?;
    if asset.kind != "video" || !asset.duration.is_finite() || asset.duration <= 0. {
        return Err("Visual measurements require a video".into());
    }
    let before = std::fs::metadata(&source).map_err(|e| e.to_string())?;
    let seconds = asset.duration.min(300.);
    let total = (seconds * 30.).ceil() as usize;
    let mut result = Vec::with_capacity(total);
    // Decode in bounded chunks so cancellation and memory remain predictable.
    let mut previous = None;
    for start in (0..seconds.ceil() as usize).step_by(4) {
        check(cancel)?;
        let bytes = execute(
            crate::command("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-nostdin",
                    "-threads",
                    "2",
                    "-ss",
                    &start.to_string(),
                    "-protocol_whitelist",
                    "file,pipe",
                    "-i",
                ])
                .arg(&source)
                .args([
                    "-t",
                    &((seconds - start as f64).min(4.)).to_string(),
                    "-map",
                    "0:v:0",
                    "-an",
                    "-vf",
                    "fps=30,scale=96:54:out_range=full,format=rgb24",
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]),
            cancel,
            PIXELS * 3 * 122,
        )?;
        for (index, rgb) in bytes.chunks_exact(PIXELS * 3).enumerate() {
            check(cancel)?;
            let time_ms = (start * 1000 + (index * 1000 + 15) / 30) as u32;
            if f64::from(time_ms) >= seconds * 1000. {
                break;
            }
            result.push(measure(rgb, previous.as_deref(), time_ms));
            previous = Some(rgb.to_vec());
        }
        report(Progress {
            completed: result.len() as u64,
            total: total as u64,
            unit: "visual frames",
        });
    }
    let after = std::fs::metadata(&source).map_err(|e| e.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("Source changed during visual measurement".into());
    }
    if result.is_empty() {
        return Err("No complete visual frames decoded".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dense_measurements_distinguish_flash_and_texture() {
        let gray = vec![64; PIXELS * 3];
        let white = vec![255; PIXELS * 3];
        let base = measure(&gray, None, 0);
        let flash = measure(&white, Some(&gray), 33);
        assert!(base.sharpness < 1e-8);
        assert_eq!(base.change, 0.);
        assert_eq!(flash.white_fraction, 1.);
        assert!(flash.change > 0.7);
        let textured: Vec<_> = (0..PIXELS)
            .flat_map(|i| {
                [if (i / WIDTH + i % WIDTH).is_multiple_of(2) {
                    0
                } else {
                    255
                }; 3]
            })
            .collect();
        assert!(measure(&textured, None, 66).sharpness > base.sharpness + 0.5);
    }
}
