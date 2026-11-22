//! Local MediaPipe body pose (OpenCV model zoo, Apache 2.0, pinned in `pose_model`). A person
//! detector finds the body with its hip-centre and full-body points; the crop is centred on the
//! hips and rotated upright on those two points, as the landmark model was trained; 33 body joints
//! come back per sample, in frame fractions with their visibility, and in metric 3D around the
//! hips. Whether a person stands, hinges, sits or lies is then measurable whatever the framing.
use super::{check, execute, vision::runtime};
use crate::{models::Progress, vision_models};
use ort::value::Tensor;
use serde::Serialize;
use std::{f32::consts::PI, path::Path, sync::atomic::AtomicBool};

pub const MODEL_DIR: &str = "mediapipe-pose-2023mar";
/// Detector input (letterboxed, NCHW, [-1, 1]).
const DET: usize = 224;
/// Landmark input (aligned crop, NHWC, [0, 1]).
const LM: usize = 256;
/// Working frame: the long side, before either model's own resize.
const LONG: usize = 448;
/// Samples per second.
const FPS: usize = 5;
const JOINTS: usize = 33;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PoseSample {
    pub time_ms: u32,
    /// Landmark confidence (0 when no person was found).
    pub score: f32,
    /// Width over height of the picture, to measure angles from frame fractions.
    pub aspect: f32,
    /// 33 joints: x, y as frame fractions, and visibility (0–1).
    pub points: Vec<[f32; 3]>,
    /// The same joints in metres around the hip centre (the model's world landmarks).
    pub world: Vec<[f32; 3]>,
}

/// The detector's SSD anchors (MediaPipe pose detection, 224 input): strides 8 and 16 with two
/// anchors a cell, and the three stride-32 layers merged (six a cell). 2,254 anchor centres.
fn anchors() -> Vec<[f32; 2]> {
    let mut out = Vec::with_capacity(2254);
    for (stride, per) in [(8usize, 2usize), (16, 2), (32, 6)] {
        let n = DET / stride;
        for y in 0..n {
            for x in 0..n {
                for _ in 0..per {
                    out.push([(x as f32 + 0.5) / n as f32, (y as f32 + 0.5) / n as f32]);
                }
            }
        }
    }
    out
}

struct Frame {
    w: usize,
    h: usize,
    rgb: Vec<u8>,
}
impl Frame {
    /// Bilinear sample (0–255 per channel), black outside the picture.
    fn sample(&self, x: f32, y: f32) -> [f32; 3] {
        if !(x > -1. && y > -1. && x < self.w as f32 && y < self.h as f32) {
            return [0.; 3];
        }
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let at = |xi: f32, yi: f32| -> [f32; 3] {
            if xi < 0. || yi < 0. || xi >= self.w as f32 || yi >= self.h as f32 {
                return [0.; 3];
            }
            let i = (yi as usize * self.w + xi as usize) * 3;
            [self.rgb[i] as f32, self.rgb[i + 1] as f32, self.rgb[i + 2] as f32]
        };
        let (a, b, c, d) = (at(x0, y0), at(x0 + 1., y0), at(x0, y0 + 1.), at(x0 + 1., y0 + 1.));
        let mut o = [0.; 3];
        for k in 0..3 {
            o[k] = (a[k] * (1. - fx) + b[k] * fx) * (1. - fy) + (c[k] * (1. - fx) + d[k] * fx) * fy;
        }
        o
    }
}

/// PPM frames from ffmpeg (`image2pipe`, `ppm`): each carries its real size, so display rotation
/// and any aspect come through without probing.
fn ppm_frames(bytes: &[u8]) -> Vec<Frame> {
    let mut out = vec![];
    let mut at = 0;
    let token = |at: &mut usize| -> Option<String> {
        while *at < bytes.len() && bytes[*at].is_ascii_whitespace() {
            *at += 1;
        }
        let start = *at;
        while *at < bytes.len() && !bytes[*at].is_ascii_whitespace() {
            *at += 1;
        }
        (start < *at).then(|| String::from_utf8_lossy(&bytes[start..*at]).into_owned())
    };
    while at < bytes.len() {
        if token(&mut at).as_deref() != Some("P6") {
            break;
        }
        let (Some(w), Some(h), Some(_max)) = (token(&mut at), token(&mut at), token(&mut at)) else { break };
        let (Ok(w), Ok(h)) = (w.parse::<usize>(), h.parse::<usize>()) else { break };
        at += 1; // the single whitespace after the maximum value
        let n = w * h * 3;
        if at + n > bytes.len() {
            break;
        }
        out.push(Frame { w, h, rgb: bytes[at..at + n].to_vec() });
        at += n;
    }
    out
}

struct Person {
    score: f32,
    hip: [f32; 2],
    full: [f32; 2],
}

fn detect(session: &mut ort::session::Session, frame: &Frame, anchors: &[[f32; 2]]) -> Result<Option<Person>, String> {
    let err = |e: ort::Error| e.to_string();
    let ratio = (DET as f32 / frame.w as f32).min(DET as f32 / frame.h as f32);
    let (rw, rh) = ((frame.w as f32 * ratio).round(), (frame.h as f32 * ratio).round());
    let (left, top) = (((DET as f32 - rw) / 2.).floor(), ((DET as f32 - rh) / 2.).floor());
    let plane = DET * DET;
    let mut input = vec![0f32; 3 * plane];
    for y in 0..DET {
        for x in 0..DET {
            let (sx, sy) = ((x as f32 + 0.5 - left) / ratio - 0.5, (y as f32 + 0.5 - top) / ratio - 0.5);
            if (x as f32) < left || (y as f32) < top || (x as f32) >= left + rw || (y as f32) >= top + rh {
                continue; // padding stays 0 in the [-1, 1] range, as the reference preprocessing does
            }
            let p = frame.sample(sx, sy);
            for c in 0..3 {
                input[c * plane + y * DET + x] = (p[c] / 255. - 0.5) * 2.;
            }
        }
    }
    let tensor = Tensor::from_array(([1, 3, DET, DET], input.into_boxed_slice())).map_err(err)?;
    let outputs = session.run(ort::inputs![tensor]).map_err(err)?;
    let mut regress: Option<Vec<f32>> = None;
    let mut scores: Option<Vec<f32>> = None;
    for (_, value) in outputs.iter() {
        let (shape, v) = value.try_extract_tensor::<f32>().map_err(err)?;
        let dims: Vec<i64> = shape.iter().copied().collect();
        match dims.last() {
            Some(12) => regress = Some(v.to_vec()),
            Some(1) => scores = Some(v.to_vec()),
            _ => {}
        }
    }
    let (Some(regress), Some(scores)) = (regress, scores) else {
        return Err("Unexpected person detector outputs".into());
    };
    if scores.len() != anchors.len() || regress.len() != anchors.len() * 12 {
        return Err(format!("Person detector anchors do not match ({} scores, {} anchors)", scores.len(), anchors.len()));
    }
    // The strongest detection (one subject per shot is what the matcher compares).
    let mut best: Option<(usize, f32)> = None;
    for (i, s) in scores.iter().enumerate() {
        let p = 1. / (1. + (-s.clamp(-100., 100.)).exp());
        if p >= 0.5 && best.map_or(true, |(_, b)| p > b) {
            best = Some((i, p));
        }
    }
    let Some((i, score)) = best else { return Ok(None) };
    let r = &regress[i * 12..i * 12 + 12];
    // Keypoints in letterboxed input pixels, back to frame pixels.
    let point = |k: usize| -> [f32; 2] {
        let x = (r[4 + 2 * k] / DET as f32 + anchors[i][0]) * DET as f32;
        let y = (r[5 + 2 * k] / DET as f32 + anchors[i][1]) * DET as f32;
        [(x - left) / ratio, (y - top) / ratio]
    };
    Ok(Some(Person { score, hip: point(0), full: point(1) }))
}

fn landmarks(session: &mut ort::session::Session, frame: &Frame, person: &Person) -> Result<Option<PoseSample>, String> {
    let err = |e: ort::Error| e.to_string();
    let [hx, hy] = person.hip;
    let dist = ((person.full[0] - hx).powi(2) + (person.full[1] - hy).powi(2)).sqrt();
    if dist < 8. {
        return Ok(None);
    }
    // Rotate so the hip→full-body axis points up (MediaPipe's alignment).
    let mut radians = PI / 2. - (-(person.full[1] - hy)).atan2(person.full[0] - hx);
    radians -= 2. * PI * ((radians + PI) / (2. * PI)).floor();
    let (a, b) = (radians.cos(), radians.sin());
    // Rotated point q = R(p - c) + c with R = [[a, b], [-b, a]]; the inverse maps a crop pixel back.
    let back = |qx: f32, qy: f32| -> [f32; 2] {
        let (dx, dy) = (qx - hx, qy - hy);
        [hx + a * dx - b * dy, hy + b * dx + a * dy]
    };
    let side = 2. * dist;
    let mut input = vec![0f32; LM * LM * 3];
    for v in 0..LM {
        for u in 0..LM {
            let q = [hx - dist + (u as f32 + 0.5) / LM as f32 * side, hy - dist + (v as f32 + 0.5) / LM as f32 * side];
            let [px, py] = back(q[0], q[1]);
            let p = frame.sample(px - 0.5, py - 0.5);
            for c in 0..3 {
                input[(v * LM + u) * 3 + c] = p[c] / 255.;
            }
        }
    }
    let tensor = Tensor::from_array(([1, LM, LM, 3], input.into_boxed_slice())).map_err(err)?;
    let outputs = session.run(ort::inputs![tensor]).map_err(err)?;
    let (mut lms, mut conf, mut world) = (None, None, None);
    for (_, value) in outputs.iter() {
        let (_, v) = value.try_extract_tensor::<f32>().map_err(err)?;
        match v.len() {
            195 => lms = Some(v.to_vec()),
            1 => conf = Some(v[0]),
            117 => world = Some(v.to_vec()),
            _ => {}
        }
    }
    let (Some(lms), Some(conf), Some(world)) = (lms, conf, world) else {
        return Err("Unexpected pose landmark outputs".into());
    };
    if conf < 0.5 {
        return Ok(None);
    }
    let sigmoid = |x: f32| 1. / (1. + (-x).exp());
    let points = (0..JOINTS)
        .map(|j| {
            let l = &lms[j * 5..j * 5 + 5];
            let [px, py] = back(hx - dist + l[0] / LM as f32 * side, hy - dist + l[1] / LM as f32 * side);
            [px / frame.w as f32, py / frame.h as f32, sigmoid(l[3]).min(sigmoid(l[4]))]
        })
        .collect();
    let world = (0..JOINTS).map(|j| [world[j * 3], world[j * 3 + 1], world[j * 3 + 2]]).collect();
    Ok(Some(PoseSample { time_ms: 0, score: conf.min(person.score), aspect: frame.w as f32 / frame.h as f32, points, world }))
}

/// Pose over [start, end) windows of a video (the whole clip when none are given), FPS samples a
/// second. A frame where nothing visibly changed reuses the previous sample.
pub fn run(
    root: &Path,
    source: &Path,
    windows: &[(u32, u32)],
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<Vec<PoseSample>, String> {
    if !crate::pose_model::verified(root) {
        return Err("Install the verified local MediaPipe pose models from AI Studio".into());
    }
    let dir = root.join(MODEL_DIR);
    let source = crate::validate_path(source)?;
    let asset = crate::inspect(&source, "pose".into())?;
    if asset.kind != "video" {
        return Err("Body pose requires video".into());
    }
    ort::init_from(vision_models::runtime(root))
        .map_err(|e| e.to_string())?
        .with_name("supp.edit.local-vision")
        .commit();
    let mut detector = runtime::session(&dir.join("person_detection.onnx"))?.0;
    let mut marker = runtime::session(&dir.join("pose_landmarks.onnx"))?.0;
    let anchors = anchors();
    let total_ms = (asset.duration * 1000.) as u32;
    let spans: Vec<(u32, u32)> = if windows.is_empty() { vec![(0, total_ms)] } else { windows.iter().map(|&(a, b)| (a.min(total_ms), b.min(total_ms))).filter(|(a, b)| b > a).collect() };
    let expected: u64 = spans.iter().map(|(a, b)| ((b - a) as u64 * FPS as u64).div_ceil(1000)).sum();
    let mut out: Vec<PoseSample> = vec![];
    let mut last: Option<(Vec<u8>, Option<PoseSample>)> = None;
    for &(from, to) in &spans {
        let mut chunk = from;
        while chunk < to {
            check(cancel)?;
            let len = (to - chunk).min(4000);
            let bytes = execute(
                crate::command("ffmpeg")
                    .args(["-v", "error", "-nostdin", "-threads", "2", "-ss", &format!("{:.3}", chunk as f64 / 1000.), "-protocol_whitelist", "file,pipe", "-i"])
                    .arg(&source)
                    .args([
                        "-t",
                        &format!("{:.3}", len as f64 / 1000.),
                        "-an",
                        "-vf",
                        &format!("fps={FPS},scale={LONG}:{LONG}:force_original_aspect_ratio=decrease"),
                        "-f",
                        "image2pipe",
                        "-vcodec",
                        "ppm",
                        "pipe:1",
                    ]),
                cancel,
                LONG * LONG * 3 * (FPS * 4 + 2) + 4096,
            )?;
            for (i, frame) in ppm_frames(&bytes).into_iter().enumerate() {
                check(cancel)?;
                let time_ms = chunk + (i * 1000 / FPS) as u32;
                if time_ms >= to {
                    break;
                }
                // Nothing visibly changed since the last measured frame: the same pose.
                if let Some((prev, sample)) = &last {
                    if prev.len() == frame.rgb.len() && still(prev, &frame.rgb) {
                        out.push(match sample {
                            Some(s) => PoseSample { time_ms, ..s.clone() },
                            None => PoseSample { time_ms, score: 0., aspect: frame.w as f32 / frame.h as f32, points: vec![], world: vec![] },
                        });
                        continue;
                    }
                }
                let measured = match detect(&mut detector, &frame, &anchors)? {
                    Some(person) => landmarks(&mut marker, &frame, &person)?,
                    None => None,
                };
                out.push(match &measured {
                    Some(s) => PoseSample { time_ms, ..s.clone() },
                    None => PoseSample { time_ms, score: 0., aspect: frame.w as f32 / frame.h as f32, points: vec![], world: vec![] },
                });
                last = Some((frame.rgb, measured));
            }
            chunk += len;
            report(Progress { completed: out.len() as u64, total: expected, unit: "pose samples" });
        }
    }
    Ok(out)
}

/// Mean absolute difference over a sparse grid below one level: the picture did not change.
fn still(a: &[u8], b: &[u8]) -> bool {
    let step = 3 * 97;
    let (mut sum, mut n) = (0u64, 0u64);
    let mut i = 0;
    while i + 2 < a.len() {
        for c in 0..3 {
            sum += a[i + c].abs_diff(b[i + c]) as u64;
        }
        n += 3;
        i += step;
    }
    n > 0 && (sum as f64 / n as f64) < 1.0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn anchors_match_the_detector_layout() {
        let a = anchors();
        assert_eq!(a.len(), 2254);
        assert!((a[0][0] - 1. / 56.).abs() < 1e-6 && (a[1][0] - 1. / 56.).abs() < 1e-6 && (a[2][0] - 3. / 56.).abs() < 1e-6);
        assert!((a[2253][0] - 13. / 14.).abs() < 1e-6 && (a[2253][1] - 13. / 14.).abs() < 1e-6);
    }
    #[test]
    fn ppm_frames_carry_their_own_size() {
        let mut bytes = b"P6\n2 1\n255\n".to_vec();
        bytes.extend([1, 2, 3, 4, 5, 6]);
        bytes.extend(b"P6\n1 1\n255\n");
        bytes.extend([7, 8, 9]);
        let f = ppm_frames(&bytes);
        assert_eq!((f.len(), f[0].w, f[0].h, f[1].rgb.clone()), (2, 2, 1, vec![7, 8, 9]));
    }
}
