//! Integration harness: encode frames produced by the actual frontend compositor.
use std::path::PathBuf;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Usage: render_frames FRAME_DIRECTORY")?,
    );
    let input = std::env::args()
        .nth(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join("project.supp"));
    let output = std::env::args()
        .nth(3)
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join("render.mp4"));
    let p = supp_project::read(&input)?;
    // Exercise native serialization as well as decoding before starting an export.
    let reopened = input.with_extension("reopened.supp");
    supp_project::save(&reopened, &p)?;
    let p = supp_project::read(&reopened)?;
    let mut encoder = supp_export::Encoder::start(&p, output)?;
    for frame in 0..p.duration() {
        encoder.frame(&std::fs::read(dir.join(format!("{frame}.png")))?)?;
    }
    println!(
        "Encoded {} frames to {}",
        p.duration(),
        encoder.finish()?.display()
    );
    Ok(())
}
