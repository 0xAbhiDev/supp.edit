use std::{path::Path, sync::atomic::AtomicBool};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let file = std::env::args()
        .nth(1)
        .ok_or("Usage: reference_visual VIDEO_PATH")?;
    let samples =
        supp_media::analysis::visual::run(Path::new(&file), &AtomicBool::new(false), |_| {})?;
    println!("{}", serde_json::to_string(&samples)?);
    Ok(())
}
