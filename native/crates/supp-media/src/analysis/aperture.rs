//! Conservative removal of constant near-black encoded border bands, not scene crops.
use super::{check, execute};
use crate::models::Progress;
use serde::Serialize;
use std::{path::Path, sync::atomic::AtomicBool};
const W: usize = 256;
const H: usize = 144;
#[derive(Serialize, Default)]
pub struct Aperture {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}
fn bounds(frame: &[u8]) -> Option<[usize; 4]> {
    // Ignore entirely dark fades, which provide no aperture evidence.
    if frame.iter().filter(|&&v| v > 32).count() < W * H / 10 {
        return None;
    }
    let row = |y: usize| (0..W).all(|x| frame[y * W + x] <= 12);
    let col = |x: usize| (0..H).all(|y| frame[y * W + x] <= 12);
    let top = (0..H / 4).take_while(|&y| row(y)).count();
    let bottom = (0..H / 4).take_while(|&y| row(H - 1 - y)).count();
    let left = (0..W / 4).take_while(|&x| col(x)).count();
    let right = (0..W / 4).take_while(|&x| col(W - 1 - x)).count();
    Some([left, top, right, bottom])
}
pub fn run(
    source: &Path,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<Aperture, String> {
    let source = crate::validate_path(source)?;
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
                "-an",
                "-vf",
                // Preserve the black-to-picture boundary. Bilinear downsampling
                // undercounts the border, leaving a black seam when enlarged.
                "fps=1,scale=256:144:flags=neighbor",
                "-pix_fmt",
                "gray",
                "-f",
                "rawvideo",
                "pipe:1",
            ]),
        cancel,
        W * H * 301,
    )?;
    let mut min = [W / 4, H / 4, W / 4, H / 4];
    let mut count = 0;
    for frame in bytes.chunks_exact(W * H) {
        check(cancel)?;
        if let Some(b) = bounds(frame) {
            count += 1;
            for i in 0..4 {
                min[i] = min[i].min(b[i]);
            }
        }
    }
    report(Progress {
        completed: 1,
        total: 1,
        unit: "source aperture",
    });
    if count < 3 {
        return Ok(Aperture::default());
    }
    // Require paired borders; a dark wall or shadow on one edge is not a letterbox.
    if min[0].min(min[2]) < 2 {
        min[0] = 0;
        min[2] = 0;
    }
    if min[1].min(min[3]) < 2 {
        min[1] = 0;
        min[3] = 0;
    }
    Ok(Aperture {
        left: min[0] as f64 / W as f64,
        top: min[1] as f64 / H as f64,
        right: min[2] as f64 / W as f64,
        bottom: min[3] as f64 / H as f64,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_constant_full_edge_bands_are_aperture_evidence() {
        let mut image = vec![100; W * H];
        for y in 0..18 {
            for x in 0..W {
                image[y * W + x] = 0;
                image[(H - 1 - y) * W + x] = 0;
            }
        }
        assert_eq!(bounds(&image), Some([0, 18, 0, 18]));
        image[2 * W + 130] = 180;
        assert_eq!(bounds(&image).unwrap()[1], 2);
        assert_eq!(bounds(&vec![0; W * H]), None);
    }
}
