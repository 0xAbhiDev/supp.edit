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
    /// Local motion between this frame and the previous one, where the picture changes.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub local: Option<LocalMotion>,
}

/// Where and which way the picture moves locally: the centroid of changing pixels (frame
/// fractions), the share of pixels that change, and one Lucas–Kanade flow vector per cell of a
/// 4×4 grid (pixels per frame at 96×54, x then y), solved only over changing pixels so a small
/// object moving on a still background is not averaged away.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalMotion {
    cx: f64,
    cy: f64,
    area: f64,
    flow: Vec<f64>,
}

fn blur(gray: &[f64]) -> Vec<f64> {
    let mut out = vec![0.; PIXELS];
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            let (mut s, mut n) = (0., 0.);
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    let (xx, yy) = (x as i32 + dx, y as i32 + dy);
                    if xx >= 0 && yy >= 0 && (xx as usize) < WIDTH && (yy as usize) < HEIGHT {
                        s += gray[yy as usize * WIDTH + xx as usize];
                        n += 1.;
                    }
                }
            }
            out[y * WIDTH + x] = s / n;
        }
    }
    out
}

fn local_motion(gray: &[f64], prior: &[f64]) -> Option<LocalMotion> {
    let (a, b) = (blur(prior), blur(gray));
    let (mut mass, mut sx, mut sy, mut moving) = (0., 0., 0., 0usize);
    // Per cell: sums for the 2×2 Lucas–Kanade system over changing pixels.
    let mut sums = [[0f64; 5]; 16];
    for y in 1..HEIGHT - 1 {
        for x in 1..WIDTH - 1 {
            let i = y * WIDTH + x;
            let it = b[i] - a[i];
            let d = (gray[i] - prior[i]).abs();
            if d < 0.02 {
                continue;
            }
            moving += 1;
            mass += d;
            sx += d * x as f64;
            sy += d * y as f64;
            let ix = ((a[i + 1] - a[i - 1]) + (b[i + 1] - b[i - 1])) / 4.;
            let iy = ((a[i + WIDTH] - a[i - WIDTH]) + (b[i + WIDTH] - b[i - WIDTH])) / 4.;
            let cell = (y * 4 / HEIGHT) * 4 + x * 4 / WIDTH;
            let s = &mut sums[cell];
            s[0] += ix * ix;
            s[1] += ix * iy;
            s[2] += iy * iy;
            s[3] += ix * it;
            s[4] += iy * it;
        }
    }
    if moving == 0 {
        return None;
    }
    let mut flow = Vec::with_capacity(32);
    for s in &sums {
        let det = s[0] * s[2] - s[1] * s[1];
        let (mut u, mut v) = (0., 0.);
        if det > 1e-9 {
            u = -(s[2] * s[3] - s[1] * s[4]) / det;
            v = -(s[0] * s[4] - s[1] * s[3]) / det;
        }
        let round = |x: f64| (x.clamp(-4., 4.) * 100.).round() / 100.;
        flow.push(round(u));
        flow.push(round(v));
    }
    Some(LocalMotion {
        cx: ((sx / mass) / WIDTH as f64 * 1000.).round() / 1000.,
        cy: ((sy / mass) / HEIGHT as f64 * 1000.).round() / 1000.,
        area: (moving as f64 / PIXELS as f64 * 10000.).round() / 10000.,
        flow,
    })
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
        local: previous.and_then(|prior| {
            let prior_gray: Vec<f64> = prior
                .chunks_exact(3)
                .map(|p| (0.2126 * f64::from(p[0]) + 0.7152 * f64::from(p[1]) + 0.0722 * f64::from(p[2])) / 255.)
                .collect();
            local_motion(&gray, &prior_gray)
        }),
        layout,
    }
}

/// Dense frames per second for a clip of this length.
pub fn dense_rate(seconds: f64) -> usize {
    if seconds > 1200. {
        15
    } else {
        30
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
    // The whole clip, decoded in 4 s chunks whose pixels are released as soon as they are
    // measured; only the compact per-frame features are kept. Past 20 minutes the dense rate
    // halves to bound memory (a cut is still a one-sample discontinuity at 15 fps).
    let seconds = asset.duration;
    let rate: usize = dense_rate(seconds);
    let total = (seconds * rate as f64).ceil() as usize;
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
                    &format!("fps={rate},scale=96:54:out_range=full,format=rgb24"),
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]),
            cancel,
            PIXELS * 3 * (4 * rate + 2),
        )?;
        for (index, rgb) in bytes.chunks_exact(PIXELS * 3).enumerate() {
            check(cancel)?;
            let time_ms = (start * 1000 + (index * 1000 + rate / 2) / rate) as u32;
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
    #[test]
    fn local_motion_follows_a_small_moving_thing() {
        // A soft blob in the upper-left quarter, one pixel lower in the next frame.
        let blob = |cx: f64, cy: f64| -> Vec<f64> {
            (0..PIXELS)
                .map(|i| {
                    let (x, y) = ((i % WIDTH) as f64, (i / WIDTH) as f64);
                    0.2 + 0.6 * (-((x - cx).powi(2) + (y - cy).powi(2)) / 18.).exp()
                })
                .collect()
        };
        let (cx, cy) = (WIDTH as f64 * 0.375, HEIGHT as f64 * 0.375);
        let before = blob(cx, cy);
        assert!(local_motion(&before, &before).is_none());
        let down = local_motion(&blob(cx, cy + 1.), &before).expect("movement");
        let cell = (cy as usize * 4 / HEIGHT) * 4 + cx as usize * 4 / WIDTH;
        let (u, v) = (down.flow[2 * cell], down.flow[2 * cell + 1]);
        assert!(v > 0.3, "downward flow {v}");
        assert!(u.abs() < 0.5 * v, "sideways {u} against {v}");
        assert!((down.cx - 0.375).abs() < 0.06 && (down.cy - 0.39).abs() < 0.08);
        assert!(down.area > 0. && down.area < 0.1);
        let right = local_motion(&blob(cx + 1., cy), &before).expect("movement");
        assert!(right.flow[2 * cell] > 0.3 && right.flow[2 * cell + 1].abs() < 0.5 * right.flow[2 * cell]);
    }
}
