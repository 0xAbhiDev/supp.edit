//! Same-footage identity: where a reference shot's own frames come from in a raw clip, whatever
//! grade, zoom, crop and small speed change the reference applied.
//!
//! A probe is one reference frame. Its picture (inside any letterbox) becomes a luma fingerprint
//! at the probe's own aspect. Each raw frame in the requested windows is searched for the region
//! of that aspect — any position, from the largest that fits down to 1/1.6 of it (a zoom) — whose
//! box-averaged luma correlates best with the fingerprint. Correlation is zero-mean and
//! normalised, so brightness, contrast, gamma-like and colour-balance grades barely change it.
//!
//! Coarse to fine: a 12-cell fingerprint over every frame and region, then a 24-cell fingerprint
//! around the best coarse peaks, with finer scale and position steps and neighbouring frames.
//! Each probe reports its best match and the best score at least 600 ms away in the same clip
//! (the next repetition or a look-alike moment), so the caller can tell the same footage from
//! similar footage. What a match means for the edit is decided by the caller.
//!
//! Appearance alone cannot separate the very frames from the same scene a moment later (another
//! repetition, a held copy of a frame): at this resolution both correlate 0.9+. Movement can. Each
//! probe also measures how its picture changes over the next 200 ms; each match measures the
//! same change in the source, in the matched region. The same footage changes the same way
//! (agreement near 1); a frozen copy does not change at all (0); another repetition changes
//! differently. A probe whose own picture does not change (a still) has no movement to compare.
use super::source_text::Interval;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::atomic::AtomicBool};

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IdentityHit {
    /// Index of the probe in the request.
    pub probe: usize,
    pub source_ms: u32,
    /// Normalised correlation of the fine fingerprints, -1..1.
    pub score: f32,
    /// Best fine score at least 600 ms away from the match in this clip (-1 when none).
    pub second: f32,
    /// Matched region of the source frame as fractions: x, y, width, height.
    pub rect: [f32; 4],
    /// Movement agreement at the match (-1..1): the source's change over the next 200 ms against
    /// the reference's. None when the reference picture does not change there.
    pub motion: Option<f32>,
    /// The refined peaks (time, score, movement agreement), best first, at least 300 ms apart:
    /// the caller aligns a shot's probes on one consistent timing across them.
    pub peaks: Vec<(u32, f32, Option<f32>)>,
}

const FINE: usize = 24;
const COARSE: usize = 12;
const LONG_SIDE: usize = 96;
const RATE: u32 = 15;
const SCALES: usize = 7;
const MIN_SCALE: f32 = 1. / 1.6;
const PEAKS: usize = 8;
/// Movement is compared over this step (3 frames at RATE).
const STEP_MS: u32 = 200;

/// A zero-mean, unit-norm fingerprint and its grid.
#[derive(Clone, Debug)]
struct Print {
    w: usize,
    h: usize,
    v: Vec<f32>,
}

/// Grid of `long` cells on the long side at `aspect` (width / height).
fn grid(aspect: f32, long: usize) -> (usize, usize) {
    if aspect >= 1. {
        (long, ((long as f32 / aspect).round() as usize).max(4))
    } else {
        (((long as f32 * aspect).round() as usize).max(4), long)
    }
}

fn normalise(mut v: Vec<f32>) -> Option<Vec<f32>> {
    let n = v.len() as f32;
    let mean = v.iter().sum::<f32>() / n;
    v.iter_mut().for_each(|x| *x -= mean);
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    // A flat picture (a flash, a black frame, a plain wall) has nothing to identify.
    if norm / n.sqrt() < 2.5 {
        return None;
    }
    v.iter_mut().for_each(|x| *x /= norm);
    Some(v)
}

/// Summed-area table of a grayscale frame, (w+1)×(h+1).
struct Integral {
    w: usize,
    h: usize,
    s: Vec<f32>,
}

impl Integral {
    fn new(gray: &[u8], w: usize, h: usize) -> Self {
        let mut s = vec![0f32; (w + 1) * (h + 1)];
        for y in 0..h {
            let mut row = 0f32;
            for x in 0..w {
                row += f32::from(gray[y * w + x]);
                s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
            }
        }
        Self { w, h, s }
    }
    /// The table at fractional pixel coordinates (bilinear), so boxes can start between pixels.
    fn at(&self, x: f32, y: f32) -> f32 {
        let x = x.clamp(0., self.w as f32);
        let y = y.clamp(0., self.h as f32);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(self.w), (y0 + 1).min(self.h));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let r = self.w + 1;
        let a = self.s[y0 * r + x0] * (1. - fx) + self.s[y0 * r + x1] * fx;
        let b = self.s[y1 * r + x0] * (1. - fx) + self.s[y1 * r + x1] * fx;
        a * (1. - fy) + b * fy
    }
    /// Box-averaged cells of the region (x, y, w, h in pixels) on a gw×gh grid.
    fn cells(&self, rect: [f32; 4], gw: usize, gh: usize, out: &mut Vec<f32>) {
        out.clear();
        let (cw, ch) = (rect[2] / gw as f32, rect[3] / gh as f32);
        let area = (cw * ch).max(1e-6);
        for j in 0..gh {
            let (ya, yb) = (rect[1] + j as f32 * ch, rect[1] + (j + 1) as f32 * ch);
            for i in 0..gw {
                let (xa, xb) = (rect[0] + i as f32 * cw, rect[0] + (i + 1) as f32 * cw);
                out.push((self.at(xb, yb) - self.at(xa, yb) - self.at(xb, ya) + self.at(xa, ya)) / area);
            }
        }
    }
}

/// Correlation of a sampled region with a fingerprint (the region is normalised here).
fn correlate(sample: &[f32], print: &[f32]) -> f32 {
    let n = sample.len() as f32;
    let mean = sample.iter().sum::<f32>() / n;
    let mut dot = 0f32;
    let mut norm = 0f32;
    for (s, p) in sample.iter().zip(print) {
        let d = s - mean;
        dot += d * p;
        norm += d * d;
    }
    if norm <= 1e-6 {
        -1.
    } else {
        dot / norm.sqrt()
    }
}

/// The picture inside a letterbox or pillarbox: edge rows and columns that are uniformly dark
/// are trimmed (never more than a third per side).
fn content_box(gray: &[u8], w: usize, h: usize) -> [usize; 4] {
    let row = |y: usize| {
        let v: Vec<f32> = (0..w).map(|x| f32::from(gray[y * w + x])).collect();
        let m = v.iter().sum::<f32>() / w as f32;
        (m, (v.iter().map(|x| (x - m).powi(2)).sum::<f32>() / w as f32).sqrt())
    };
    let col = |x: usize| {
        let v: Vec<f32> = (0..h).map(|y| f32::from(gray[y * w + x])).collect();
        let m = v.iter().sum::<f32>() / h as f32;
        (m, (v.iter().map(|x| (x - m).powi(2)).sum::<f32>() / h as f32).sqrt())
    };
    let bar = |(m, s): (f32, f32)| m < 14. && s < 6.;
    let (mut top, mut bottom, mut left, mut right) = (0, h, 0, w);
    while top < h / 3 && bar(row(top)) {
        top += 1;
    }
    while bottom > h - h / 3 && bar(row(bottom - 1)) {
        bottom -= 1;
    }
    while left < w / 3 && bar(col(left)) {
        left += 1;
    }
    while right > w - w / 3 && bar(col(right - 1)) {
        right -= 1;
    }
    [left, top, right - left, bottom - top]
}

/// One reference frame: its fingerprints at the aspect of its content, and how its picture
/// changes over the next STEP_MS (normalised), when it does.
#[derive(Clone, Debug)]
struct Probe {
    aspect: f32,
    coarse: Print,
    fine: Print,
    motion: Option<Vec<f32>>,
}

/// Fine-grid cells of a frame's content box, unnormalised (for movement).
fn raw_cells(gray: &[u8], w: usize, h: usize, area: [usize; 4], gw: usize, gh: usize) -> Vec<f32> {
    let mut v = Vec::new();
    Integral::new(gray, w, h).cells([area[0] as f32, area[1] as f32, area[2] as f32, area[3] as f32], gw, gh, &mut v);
    v
}

/// The change between two cell grids, normalised; None when it is below the noise of a still.
fn change(a: &[f32], b: &[f32], floor: f32) -> Option<Vec<f32>> {
    let d: Vec<f32> = a.iter().zip(b).map(|(x, y)| y - x).collect();
    let rms = (d.iter().map(|v| v * v).sum::<f32>() / d.len() as f32).sqrt();
    if rms < floor {
        return None;
    }
    let mean = d.iter().sum::<f32>() / d.len() as f32;
    let centred: Vec<f32> = d.iter().map(|v| v - mean).collect();
    let norm = centred.iter().map(|v| v * v).sum::<f32>().sqrt();
    (norm > 1e-6).then(|| centred.iter().map(|v| v / norm).collect())
}

/// Fingerprints of one reference frame; `next` (the frame STEP_MS later) gives its movement.
fn probe_prints(gray: &[u8], w: usize, h: usize, next: Option<&[u8]>) -> Option<Probe> {
    let area = content_box(gray, w, h);
    let [x, y, cw, ch] = area;
    let aspect = cw as f32 / ch.max(1) as f32;
    let table = Integral::new(gray, w, h);
    let make = |long: usize| {
        let (gw, gh) = grid(aspect, long);
        let mut v = Vec::new();
        table.cells([x as f32, y as f32, cw as f32, ch as f32], gw, gh, &mut v);
        normalise(v).map(|v| Print { w: gw, h: gh, v })
    };
    let coarse = make(COARSE)?;
    let fine = make(FINE)?;
    let motion = next.and_then(|n| change(&raw_cells(gray, w, h, area, fine.w, fine.h), &raw_cells(n, w, h, area, fine.w, fine.h), 1.5));
    Some(Probe { aspect, coarse, fine, motion })
}

/// Regions of a w×h frame with the given aspect: the largest that fits, down to MIN_SCALE of it,
/// at positions spaced by `step` of the region's width and height.
fn regions(w: usize, h: usize, aspect: f32, scales: &[f32], step: f32) -> Vec<[f32; 4]> {
    let (fw, fh) = (w as f32, h as f32);
    let (mw, mh) = if aspect < fw / fh { (fh * aspect, fh) } else { (fw, fw / aspect) };
    let mut out = vec![];
    for &s in scales {
        let (rw, rh) = (mw * s, mh * s);
        let (sx, sy) = ((rw * step).max(1.), (rh * step).max(1.));
        let (nx, ny) = (((fw - rw) / sx).floor() as usize, ((fh - rh) / sy).floor() as usize);
        for j in 0..=ny {
            for i in 0..=nx {
                // Spread the positions so both edges are reached.
                let x = if nx == 0 { (fw - rw) / 2. } else { (fw - rw) * i as f32 / nx as f32 };
                let y = if ny == 0 { (fh - rh) / 2. } else { (fh - rh) * j as f32 / ny as f32 };
                out.push([x, y, rw, rh]);
            }
        }
    }
    out
}

fn scale_ladder() -> Vec<f32> {
    (0..SCALES).map(|k| 1. - (1. - MIN_SCALE) * k as f32 / (SCALES - 1) as f32).collect()
}

/// Search decoded frames (time, gray) for each probe. Pure: the decoding is the caller's.
fn search(probes: &[Option<Probe>], frames: &[(u32, Vec<u8>)], w: usize, h: usize, cancel: &AtomicBool) -> Result<Vec<IdentityHit>, String> {
    let ladder = scale_ladder();
    // Coarse: best score per probe per frame, with its region.
    let mut coarse: Vec<Vec<(f32, usize, [f32; 4])>> = vec![Vec::with_capacity(frames.len()); probes.len()];
    // Probes that share an aspect share their sampled regions.
    let mut aspects: Vec<f32> = probes.iter().flatten().map(|p| p.aspect).collect();
    aspects.sort_by(|a, b| a.total_cmp(b));
    aspects.dedup_by(|a, b| (*a - *b).abs() < 0.02);
    let plans: Vec<(f32, Vec<[f32; 4]>)> = aspects.iter().map(|&a| (a, regions(w, h, a, &ladder, 0.125))).collect();
    let mut sample = Vec::new();
    // Coarse on every second frame; the fine pass looks at the neighbours.
    for (f, (_, gray)) in frames.iter().enumerate() {
        if f % 32 == 0 {
            super::check(cancel)?;
        }
        if f % 2 == 1 {
            continue;
        }
        let table = Integral::new(gray, w, h);
        let mut best: Vec<(f32, [f32; 4])> = vec![(-2., [0.; 4]); probes.len()];
        for (aspect, rects) in &plans {
            let users: Vec<usize> = probes.iter().enumerate().filter(|(_, p)| p.as_ref().is_some_and(|p| (p.aspect - aspect).abs() < 0.02)).map(|(i, _)| i).collect();
            if users.is_empty() {
                continue;
            }
            let (gw, gh) = { let p = probes[users[0]].as_ref().unwrap(); (p.coarse.w, p.coarse.h) };
            for rect in rects {
                table.cells(*rect, gw, gh, &mut sample);
                for &u in &users {
                    let c = correlate(&sample, &probes[u].as_ref().unwrap().coarse.v);
                    if c > best[u].0 {
                        best[u] = (c, *rect);
                    }
                }
            }
        }
        for (u, b) in best.into_iter().enumerate() {
            if probes[u].is_some() {
                coarse[u].push((b.0, f, b.1));
            }
        }
    }
    let mut out = vec![];
    for (u, probe) in probes.iter().enumerate() {
        let Some(Probe { fine, motion, .. }) = probe else { continue };
        // Peaks of the coarse curve at least 300 ms apart.
        let mut order: Vec<&(f32, usize, [f32; 4])> = coarse[u].iter().collect();
        order.sort_by(|a, b| b.0.total_cmp(&a.0));
        let mut peaks: Vec<(f32, usize, [f32; 4])> = vec![];
        for c in order {
            if peaks.len() >= PEAKS {
                break;
            }
            if peaks.iter().all(|p| frames[p.1].0.abs_diff(frames[c.1].0) >= 300) {
                peaks.push(*c);
            }
        }
        // Fine: around each peak, finer scale and position steps on its frame, then neighbours.
        let mut refined: Vec<(f32, u32, [f32; 4], usize)> = vec![];
        // Best region on one frame around `rect`: scale steps of 3.5% and position steps of a
        // 24th of the region, `reach` steps each way.
        let mut local = |table: &Integral, rect: [f32; 4], reach: i32| {
            let (mut score, mut at) = (-2f32, rect);
            for k in -reach.min(2)..=reach.min(2) {
                let s = 1. + 0.035 * k as f32;
                let (rw, rh) = (rect[2] * s, rect[3] * s);
                if rw > w as f32 + 0.01 || rh > h as f32 + 0.01 {
                    continue;
                }
                let (cx, cy) = (rect[0] + rect[2] / 2., rect[1] + rect[3] / 2.);
                for dy in -reach..=reach {
                    for dx in -reach..=reach {
                        let x = (cx - rw / 2. + dx as f32 * rect[2] / 24.).clamp(0., w as f32 - rw);
                        let y = (cy - rh / 2. + dy as f32 * rect[3] / 24.).clamp(0., h as f32 - rh);
                        let r = [x, y, rw, rh];
                        table.cells(r, fine.w, fine.h, &mut sample);
                        let c = correlate(&sample, &fine.v);
                        if c > score {
                            score = c;
                            at = r;
                        }
                    }
                }
            }
            (score, at)
        };
        for (_, f, rect) in peaks {
            super::check(cancel)?;
            // The coarse peak's frame: a wide local search; then each neighbour (the coarse pass
            // skipped every second frame) with a narrow one around that region.
            let (mut score, mut at) = local(&Integral::new(&frames[f].1, w, h), rect, 3);
            let mut time = frames[f].0;
            let mut index = f;
            let base = at;
            for g in f.saturating_sub(3)..(f + 4).min(frames.len()) {
                if g == f {
                    continue;
                }
                let (c, r) = local(&Integral::new(&frames[g].1, w, h), base, 1);
                if c > score {
                    score = c;
                    at = r;
                    time = frames[g].0;
                    index = g;
                }
            }
            if refined.iter().all(|r| r.1.abs_diff(time) >= 300) {
                refined.push((score, time, at, index));
            }
        }
        refined.sort_by(|a, b| b.0.total_cmp(&a.0));
        // Movement at each refined match: the source's change over STEP_MS in the matched region
        // against the reference's. A source that does not change cannot be a reference that does.
        let moved = |index: usize, rect: [f32; 4]| -> Option<f32> {
            let m = motion.as_ref()?;
            let later = frames.iter().enumerate().skip(index + 1).find(|(_, fr)| fr.0 >= frames[index].0 + STEP_MS - 20).map(|(k, _)| k)?;
            if frames[later].0 > frames[index].0 + STEP_MS + 40 {
                return None;
            }
            let (mut a, mut b) = (Vec::new(), Vec::new());
            Integral::new(&frames[index].1, w, h).cells(rect, fine.w, fine.h, &mut a);
            Integral::new(&frames[later].1, w, h).cells(rect, fine.w, fine.h, &mut b);
            Some(match change(&a, &b, 0.75) {
                Some(d) => d.iter().zip(m).map(|(x, y)| x * y).sum::<f32>(),
                None => 0.,
            })
        };
        let peaks: Vec<(u32, f32, Option<f32>)> = refined.iter().map(|r| (r.1, (r.0 * 1000.).round() / 1000., moved(r.3, r.2).map(|v| (v * 1000.).round() / 1000.))).collect();
        let Some(&(score, time, rect, _)) = refined.first() else { continue };
        let second = refined.iter().filter(|r| r.1.abs_diff(time) >= 600).map(|r| r.0).fold(-1f32, f32::max);
        out.push(IdentityHit {
            probe: u,
            source_ms: time,
            score,
            second,
            rect: [rect[0] / w as f32, rect[1] / h as f32, rect[2] / w as f32, rect[3] / h as f32],
            motion: peaks.first().and_then(|p| p.2),
            peaks,
        });
    }
    Ok(out)
}

/// Frame size for decoding: LONG_SIDE on the long side, even dimensions.
fn decode_size(width: u32, height: u32, long: usize) -> (usize, usize) {
    let (w, h) = (f64::from(width.max(1)), f64::from(height.max(1)));
    let even = |v: f64| ((v / 2.).round() as usize * 2).max(2);
    if w >= h {
        (long, even(long as f64 * h / w))
    } else {
        (even(long as f64 * w / h), long)
    }
}

fn gray_frames(source: &Path, start_ms: u32, end_ms: u32, w: usize, h: usize, rate: Option<u32>, cancel: &AtomicBool) -> Result<Vec<(u32, Vec<u8>)>, String> {
    let seconds = f64::from(end_ms.saturating_sub(start_ms)) / 1000.;
    let filter = match rate {
        Some(r) => format!("fps={r},scale={w}:{h}:out_range=full,format=gray"),
        None => format!("scale={w}:{h}:out_range=full,format=gray"),
    };
    let mut cmd = crate::command("ffmpeg");
    cmd.args(["-v", "error", "-nostdin", "-threads", "2", "-ss", &format!("{:.3}", f64::from(start_ms) / 1000.), "-protocol_whitelist", "file,pipe", "-i"])
        .arg(source)
        .args(["-map", "0:v:0", "-an", "-vf", &filter, "-pix_fmt", "gray", "-f", "rawvideo"]);
    match rate {
        Some(_) => cmd.args(["-t", &format!("{seconds:.3}")]),
        None => cmd.args(["-frames:v", "1"]),
    };
    cmd.arg("pipe:1");
    let r = rate.unwrap_or(1);
    let bytes = super::execute(&mut cmd, cancel, w * h * ((seconds * f64::from(r)).ceil() as usize + 2))?;
    Ok(bytes
        .chunks_exact(w * h)
        .enumerate()
        .map(|(i, g)| (start_ms + (i as u32 * 1000 + r / 2) / r, g.to_vec()))
        .take_while(|(t, _)| rate.is_none() || *t < end_ms)
        .collect())
}

/// Where each reference probe (milliseconds in `reference`) best matches inside `windows` of
/// `source`. At most 600 s of windows per call.
pub fn run(reference: &Path, probes: &[u32], source: &Path, windows: &[Interval], cancel: &AtomicBool) -> Result<Vec<IdentityHit>, String> {
    let reference = crate::validate_path(reference)?;
    let source = crate::validate_path(source)?;
    let ra = crate::inspect(&reference, "identity".into())?;
    let sa = crate::inspect(&source, "identity".into())?;
    if ra.kind != "video" || sa.kind != "video" {
        return Err("Identity matching compares two videos".into());
    }
    let (pw, ph) = decode_size(ra.width, ra.height, 128);
    let mut prints = vec![];
    for &ms in probes.iter().take(256) {
        super::check(cancel)?;
        let frame = gray_frames(&reference, ms, ms + 1, pw, ph, None, cancel)?;
        let next = gray_frames(&reference, ms + STEP_MS, ms + STEP_MS + 1, pw, ph, None, cancel)?;
        prints.push(frame.first().and_then(|(_, g)| probe_prints(g, pw, ph, next.first().map(|(_, n)| n.as_slice()))));
    }
    let (w, h) = decode_size(sa.width, sa.height, LONG_SIDE);
    let limit = (sa.duration * 1000.).floor() as u32;
    let mut spans: Vec<(u32, u32)> = windows.iter().map(|i| (i.start_ms.min(limit), i.end_ms.min(limit))).filter(|s| s.1 > s.0).collect();
    spans.sort();
    let mut merged: Vec<(u32, u32)> = vec![];
    for s in spans {
        match merged.last_mut() {
            Some(last) if s.0 <= last.1 + 200 => last.1 = last.1.max(s.1),
            _ => merged.push(s),
        }
    }
    let mut total = 0;
    let mut frames = vec![];
    for (a, b) in merged {
        let b = b.min(a + 600_000 - total);
        if b <= a {
            break;
        }
        total += b - a;
        frames.extend(gray_frames(&source, a, b, w, h, Some(RATE), cancel)?);
    }
    if frames.is_empty() {
        return Ok(vec![]);
    }
    search(&prints, &frames, w, h, cancel)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A textured frame (smooth blobs and edges) w×h.
    fn scene(w: usize, h: usize, phase: f32) -> Vec<u8> {
        (0..w * h)
            .map(|i| {
                let (x, y) = ((i % w) as f32 / w as f32, (i / w) as f32 / h as f32);
                let v = 0.5 + 0.25 * (9. * x + phase).sin() * (7. * y).cos() + 0.2 * ((x - 0.6).powi(2) + (y - 0.4).powi(2) < 0.03) as i32 as f32 + 0.1 * (23. * x * y + phase).sin();
                (v.clamp(0., 1.) * 255.) as u8
            })
            .collect()
    }

    /// The reference frame: a region of the source, resampled, regraded (contrast, gamma, offset)
    /// and letterboxed.
    fn reframe(src: &[u8], sw: usize, sh: usize, rect: [f32; 4], w: usize, h: usize, bar: usize) -> Vec<u8> {
        let mut out = vec![0u8; w * h];
        for y in bar..h - bar {
            for x in 0..w {
                let sx = (rect[0] + rect[2] * (x as f32 + 0.5) / w as f32) as usize;
                let sy = (rect[1] + rect[3] * ((y - bar) as f32 + 0.5) / (h - 2 * bar) as f32) as usize;
                let v = f32::from(src[sy.min(sh - 1) * sw + sx.min(sw - 1)]) / 255.;
                out[y * w + x] = ((0.1 + 0.8 * v.powf(1.15)).clamp(0., 1.) * 255.) as u8;
            }
        }
        out
    }

    #[test]
    fn finds_a_regraded_zoomed_crop_and_tells_it_from_other_moments() {
        let (sw, sh) = (96, 54);
        // Two seconds of a picture that changes smoothly (as video does); frame 7 — an odd frame,
        // which the coarse pass skips — is the one the reference took.
        let frames: Vec<(u32, Vec<u8>)> = (0..30).map(|k| (k * 67, scene(sw, sh, k as f32 * 0.17))).collect();
        // A vertical 9:16 crop zoomed 1.2× at the right of frame 7, letterboxed top and bottom.
        let rect = [55., 4., 54. * 9. / 16. / 1.2, 54. / 1.2];
        let reference = reframe(&frames[7].1, sw, sh, rect, 72, 140, 6);
        let later = reframe(&frames[10].1, sw, sh, rect, 72, 140, 6);
        let probe = probe_prints(&reference, 72, 140, Some(&later)).expect("a textured probe");
        let hits = search(&[Some(probe)], &frames, sw, sh, &AtomicBool::new(false)).unwrap();
        let hit = &hits[0];
        assert_eq!(hit.source_ms, 7 * 67);
        assert!(hit.score > 0.9, "score {}", hit.score);
        assert!(hit.score - hit.second > 0.05, "next {} vs {}", hit.second, hit.score);
        // The matched region is where the crop was taken.
        assert!((hit.rect[0] * 96. - 55.).abs() < 4., "x {}", hit.rect[0] * 96.);
        assert!((hit.rect[2] * 96. - rect[2]).abs() < 4., "w {}", hit.rect[2] * 96.);
        // The source changes the way the reference does over the next 200 ms.
        assert!(hit.motion.unwrap() > 0.8, "movement {:?}", hit.motion);
    }

    #[test]
    fn a_frozen_copy_of_the_frame_does_not_move_like_the_reference() {
        let (sw, sh) = (96, 54);
        // The picture held still for two seconds: the right picture, but frozen.
        let held = scene(sw, sh, 7. * 0.17);
        let frames: Vec<(u32, Vec<u8>)> = (0..30).map(|k| (k * 67, held.clone())).collect();
        let rect = [55., 4., 54. * 9. / 16. / 1.2, 54. / 1.2];
        let reference = reframe(&held, sw, sh, rect, 72, 140, 6);
        let later = reframe(&scene(sw, sh, 10. * 0.17), sw, sh, rect, 72, 140, 6);
        let probe = probe_prints(&reference, 72, 140, Some(&later)).unwrap();
        let hit = &search(&[Some(probe)], &frames, sw, sh, &AtomicBool::new(false)).unwrap()[0];
        assert!(hit.score > 0.9);
        assert_eq!(hit.motion, Some(0.));
    }

    #[test]
    fn flat_frames_have_no_identity() {
        assert!(probe_prints(&vec![200u8; 64 * 36], 64, 36, None).is_none());
    }
}
