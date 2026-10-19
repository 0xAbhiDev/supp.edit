//! Integration harness: encode frames produced by the actual frontend compositor.
use std::path::PathBuf;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Usage: render_frames FRAME_DIRECTORY")?,
    );
    let p = supp_project::read(&dir.join("project.supp"))?;
    let mut encoder = supp_export::Encoder::start(&p, dir.join("render.mp4"))?;
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
