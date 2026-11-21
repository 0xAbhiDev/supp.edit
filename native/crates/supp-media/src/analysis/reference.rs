//! Low-resolution block motion for editing analysis. No frames or source audio are persisted.
use super::{check, execute};
use crate::models::Progress;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::atomic::AtomicBool};
const W: usize = 96;
const H: usize = 54;
const N: usize = W * H;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Motion {
    time_ms: u32,
    pub(crate) pan_x: f64,
    pub(crate) pan_y: f64,
    pub(crate) expansion: f64,
    intensity: f64,
    pub(crate) confidence: f64,
    freeze: bool,
    edge_darkening: f64,
    black_bars: bool,
    cadence_hold_ms: Option<u32>,
    /// Sub-pixel camera translation and scale per frame (block-matching cost parabola): slow
    /// pans below half a pixel per frame read as zero in the whole-pixel estimate.
    #[serde(skip_serializing, default)]
    pub(crate) fine_x: f64,
    #[serde(skip_serializing, default)]
    pub(crate) fine_y: f64,
    #[serde(skip_serializing, default)]
    pub(crate) fine_expansion: f64,
}
fn median(mut x: Vec<f64>) -> f64 {
    x.sort_by(f64::total_cmp);
    x.get(x.len() / 2).copied().unwrap_or(0.)
}
pub(crate) fn describe(a: &[u8], b: &[u8], time_ms: u32) -> Motion {
    // Smoothed copies for the sub-pixel step: fine repeating texture (windows, grilles, fabric)
    // aliases at the analysis size and breaks the gradient linearisation.
    let smooth = |p: &[u8]| -> Vec<f64> {
        let mut out = vec![0f64; N];
        for y in 0..H {
            for x in 0..W {
                let (mut sum, mut n) = (0f64, 0f64);
                for dy in -2isize..=2 {
                    for dx in -2isize..=2 {
                        let (xx, yy) = (x as isize + dx, y as isize + dy);
                        if xx >= 0 && yy >= 0 && (xx as usize) < W && (yy as usize) < H {
                            sum += f64::from(p[yy as usize * W + xx as usize]);
                            n += 1.;
                        }
                    }
                }
                out[y * W + x] = sum / n;
            }
        }
        out
    };
    let (sa, sb) = (smooth(a), smooth(b));
    let mut vectors = vec![];
    for y in (8..H - 8).step_by(8) {
        for x in (8..W - 8).step_by(10) {
            let mut best = (u32::MAX, 0, 0);
            let mut second = u32::MAX;
            for dy in -3isize..=3 {
                for dx in -3isize..=3 {
                    let mut cost = 0u32;
                    for j in 0..5 {
                        for i in 0..5 {
                            let start = (y + j) * W + x + i;
                            let end = (start as isize + dy * W as isize + dx) as usize;
                            cost += a[start].abs_diff(b[end]) as u32;
                        }
                    }
                    if cost < best.0 {
                        second = best.0;
                        best = (cost, dx, dy)
                    } else if cost < second {
                        second = cost
                    }
                }
            }
            if best.0 < 25 * 20 && second.saturating_sub(best.0) > 12 {
                // Sub-pixel: a Lucas–Kanade step from the best whole-pixel match, using the
                // gradients of the matched picture. Identical pictures give exactly zero (cost
                // parabolas are biased by texture asymmetry and read a still picture as a pan).
                let (bx, by) = (best.1, best.2);
                let (mut gxx, mut gxy, mut gyy, mut gxt, mut gyt) = (0f64, 0f64, 0f64, 0f64, 0f64);
                for j in 0..5 {
                    for i in 0..5 {
                        let p = (y + j) * W + x + i;
                        let q = (p as isize + by * W as isize + bx) as usize;
                        let gx = (sb[q + 1] - sb[q - 1]) / 2.;
                        let gy = (sb[q + W] - sb[q - W]) / 2.;
                        let it = sb[q] - sa[p];
                        gxx += gx * gx;
                        gxy += gx * gy;
                        gyy += gy * gy;
                        gxt += gx * it;
                        gyt += gy * it;
                    }
                }
                let det = gxx * gyy - gxy * gxy;
                let (fx, fy) = if det > 1e-6 {
                    (
                        (-(gyy * gxt - gxy * gyt) / det).clamp(-0.5, 0.5),
                        (-(gxx * gyt - gxy * gxt) / det).clamp(-0.5, 0.5),
                    )
                } else {
                    (0., 0.)
                };
                vectors.push((
                    x as f64 / W as f64 - 0.5,
                    y as f64 / H as f64 - 0.5,
                    best.1 as f64,
                    best.2 as f64,
                    best.1 as f64 + fx,
                    best.2 as f64 + fy,
                ))
            }
        }
    }
    let pan_x = median(vectors.iter().map(|v| v.2).collect());
    let pan_y = median(vectors.iter().map(|v| v.3).collect());
    let fine_x = median(vectors.iter().map(|v| v.4).collect());
    let fine_y = median(vectors.iter().map(|v| v.5).collect());
    let fine_expansion = median(
        vectors
            .iter()
            .filter_map(|v| {
                let rx = v.0 * W as f64;
                let ry = v.1 * H as f64;
                let radius = rx * rx + ry * ry;
                (radius > 140.).then(|| ((v.4 - fine_x) * rx + (v.5 - fine_y) * ry) / radius)
            })
            .collect(),
    );
    let expansion = median(
        vectors
            .iter()
            .filter_map(|v| {
                let rx = v.0 * W as f64;
                let ry = v.1 * H as f64;
                let radius = rx * rx + ry * ry;
                (radius > 140.).then(|| ((v.2 - pan_x) * rx + (v.3 - pan_y) * ry) / radius)
            })
            .collect(),
    );
    let delta = a
        .iter()
        .zip(b)
        .map(|(&a, &b)| f64::from(a.abs_diff(b)))
        .sum::<f64>()
        / (N as f64 * 255.);
    let mut corner = 0.;
    let mut center = 0.;
    let mut count = 0.;
    for y in 0..H / 5 {
        for x in 0..W / 5 {
            corner += f64::from(b[y * W + x]) + f64::from(b[(H - 1 - y) * W + W - 1 - x]);
            center += 2. * f64::from(b[(H / 2 - H / 10 + y) * W + W / 2 - W / 10 + x]);
            count += 2.;
        }
    }
    Motion {
        time_ms,
        cadence_hold_ms: None,
        pan_x,
        pan_y,
        expansion,
        fine_x,
        fine_y,
        fine_expansion,
        intensity: delta,
        confidence: (vectors.len() as f64 / 40.).min(1.),
        freeze: delta < 0.001,
        edge_darkening: ((center - corner) / (count * 255.)).clamp(0., 1.),
        black_bars: b[..W * 2]
            .iter()
            .chain(&b[N - W * 2..])
            .filter(|&&v| v < 12)
            .count()
            > W * 4 * 95 / 100,
    }
}
pub fn run(
    source: &Path,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<Vec<Motion>, String> {
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
                "-t",
                "300",
                "-map",
                "0:v:0",
                "-an",
                "-vf",
                "fps=8,scale=96:54",
                "-pix_fmt",
                "gray",
                "-f",
                "rawvideo",
                "pipe:1",
            ]),
        cancel,
        N * 2402,
    )?;
    let frames = bytes.chunks_exact(N);
    let total = frames.len();
    let mut last = None;
    let mut result = vec![];
    for (i, frame) in frames.enumerate() {
        check(cancel)?;
        if let Some(prev) = last {
            result.push(describe(prev, frame, (i * 125) as u32))
        }
        last = Some(frame);
        if i % 16 == 0 {
            report(Progress {
                completed: i as u64,
                total: total as u64,
                unit: "motion frames",
            })
        }
    }
    // Look for an exceptional run of near-identical frames bounded by moving images.
    // Normal low-frame-rate material repeats throughout and must not trigger a ramp.
    let center = execute(
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
                "-t",
                "300",
                "-map",
                "0:v:0",
                "-an",
                "-vf",
                "fps=30,crop=iw*0.6:ih*0.45,scale=48:36",
                "-pix_fmt",
                "gray",
                "-f",
                "rawvideo",
                "pipe:1",
            ]),
        cancel,
        48 * 36 * 9001,
    )?;
    let frames: Vec<_> = center.chunks_exact(48 * 36).collect();
    let change: Vec<_> = frames
        .windows(2)
        .map(|pair| {
            pair[0]
                .iter()
                .zip(pair[1])
                .map(|(a, b)| f64::from(a.abs_diff(*b)))
                .sum::<f64>()
                / (48. * 36.)
        })
        .collect();
    let mut i = 0;
    while i < change.len() {
        check(cancel)?;
        if change[i] > 0.5 {
            i += 1;
            continue;
        }
        let start = i;
        while i < change.len() && change[i] <= 0.5 {
            i += 1;
        }
        let count = i - start;
        if !(4..=12).contains(&count) || start < 12 || i + 12 >= change.len() {
            continue;
        }
        if change[start - 1] < 3.0 || change[i] < 3.0 {
            continue;
        }
        let near = &change[start - 12..start];
        let after = &change[i..i + 12];
        if [near, after]
            .iter()
            .any(|s| s.iter().filter(|v| **v > 2.).count() < 4)
        {
            continue;
        }
        if near
            .windows(count)
            .chain(after.windows(count))
            .any(|span| span.iter().all(|n| *n <= 0.5))
        {
            continue;
        }
        let ms = ((start + i + 2) * 1000 / 60) as u32;
        if let Some(row) = result.get_mut((ms as usize + 62) / 125 - 1) {
            row.cadence_hold_ms = Some(ms);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod camera_tests {
    use super::*;
    #[test]
    fn slow_pans_are_measured_below_one_pixel_per_frame() {
        // A smooth texture, then the same texture moved 0.3 analysis pixels to the right.
        let frame = |shift: f64| -> Vec<u8> {
            (0..N)
                .map(|i| {
                    let (x, y) = ((i % W) as f64 - shift, (i / W) as f64);
                    (128. + 60. * (x / 3.1).sin() * (y / 4.3).cos() + 40. * (x / 7.7 + y / 5.9).sin()).round() as u8
                })
                .collect()
        };
        let m = describe(&frame(0.), &frame(0.3), 0);
        assert_eq!(m.pan_x, 0.);
        assert!((m.fine_x - 0.3).abs() < 0.12, "fine pan {}", m.fine_x);
        assert!(m.fine_y.abs() < 0.12, "fine y {}", m.fine_y);
        let still = describe(&frame(0.), &frame(0.), 0);
        assert!(still.fine_x.abs() < 0.02 && still.fine_y.abs() < 0.02, "still {} {}", still.fine_x, still.fine_y);
    }
}
