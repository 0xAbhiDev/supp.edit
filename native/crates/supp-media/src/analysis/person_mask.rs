//! Sample a local PP-HumanSeg probability map and retain the largest exterior contour.
use super::{check, execute, vision::runtime};
use crate::{models::Progress, vision_models};
use ort::value::Tensor;
use serde::Serialize;
use std::{collections::HashMap, path::Path, sync::atomic::AtomicBool};
const N: usize = 192;
const PLANE: usize = N * N;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskSample {
    time_ms: u32,
    points: Vec<[f32; 2]>,
}

fn contour(mask: &[bool]) -> Vec<[f32; 2]> {
    let mut edges: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut add = |a, b| edges.entry(a).or_default().push(b);
    for y in 0..N {
        for x in 0..N {
            let i = y * N + x;
            if !mask[i] {
                continue;
            }
            let a = y * (N + 1) + x;
            let b = a + 1;
            let d = a + N + 1;
            let c = d + 1;
            if y == 0 || !mask[i - N] {
                add(a, b)
            }
            if x + 1 == N || !mask[i + 1] {
                add(b, c)
            }
            if y + 1 == N || !mask[i + N] {
                add(c, d)
            }
            if x == 0 || !mask[i - 1] {
                add(d, a)
            }
        }
    }
    let mut best = vec![];
    let mut area = 80.;
    // Fixed scan order makes the outline reproducible even for diagonal contacts.
    for start in 0..(N + 1) * (N + 1) {
        while edges.contains_key(&start) {
            let mut path = vec![];
            let mut at = start;
            let mut signed = 0.;
            loop {
                let Some(nexts) = edges.get_mut(&at) else {
                    break;
                };
                let next = nexts.pop().unwrap();
                if nexts.is_empty() {
                    edges.remove(&at);
                }
                let xy = |v: usize| [(v % (N + 1)) as f32, (v / (N + 1)) as f32];
                let [x, y] = xy(at);
                let [u, v] = xy(next);
                signed += x * v - y * u;
                path.push([x / N as f32, y / N as f32]);
                at = next;
                if at == start {
                    break;
                }
            }
            if signed > area && path.len() >= 32 {
                area = signed;
                best = path;
            }
        }
    }
    if best.is_empty() {
        return best;
    }
    (0..96).map(|i| best[i * best.len() / 96]).collect()
}

pub fn run(
    root: &Path,
    source: &Path,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<Vec<MaskSample>, String> {
    let model = root.join("pphumanseg-2023mar/model.onnx");
    if !crate::person_model::verified(root) {
        return Err("Install the verified local PP-HumanSeg model from AI Studio".into());
    }
    let source = crate::validate_path(source)?;
    let asset = crate::inspect(&source, "person-mask".into())?;
    if asset.kind != "video" {
        return Err("Person segmentation requires video".into());
    }
    let err = |e: ort::Error| e.to_string();
    ort::init_from(vision_models::runtime(root))
        .map_err(|e| e.to_string())?
        .with_name("supp.edit.local-vision")
        .commit();
    let mut session = runtime::session(&model)?.0;
    // The whole clip, 4 s at a time (pixels released per chunk).
    let seconds = asset.duration;
    let mut out = vec![];
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
                    &(seconds - start as f64).min(4.).to_string(),
                    "-an",
                    "-vf",
                    "fps=10,scale=192:192",
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]),
            cancel,
            PLANE * 3 * 41,
        )?;
        for (i, rgb) in bytes.chunks_exact(PLANE * 3).enumerate() {
            check(cancel)?;
            let mut input = vec![0.; 3 * PLANE];
            for (j, p) in rgb.chunks_exact(3).enumerate() {
                for c in 0..3 {
                    input[c * PLANE + j] = f32::from(p[c]) / 127.5 - 1.;
                }
            }
            let tensor =
                Tensor::from_array(([1, 3, N, N], input.into_boxed_slice())).map_err(err)?;
            let outputs = session.run(ort::inputs![tensor]).map_err(err)?;
            let (shape, v) = outputs[0].try_extract_tensor::<f32>().map_err(err)?;
            if **shape != [1, 2, 192, 192] {
                return Err("Unexpected PP-HumanSeg output".into());
            }
            let mask: Vec<_> = (0..PLANE).map(|j| v[PLANE + j] > v[j]).collect();
            out.push(MaskSample {
                time_ms: (start * 1000 + i * 100) as u32,
                points: contour(&mask),
            });
        }
        report(Progress {
            completed: out.len() as u64,
            total: (seconds * 10.).ceil() as u64,
            unit: "subject masks",
        });
    }
    Ok(out)
}
