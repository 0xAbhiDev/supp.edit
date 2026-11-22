use std::{path::Path, sync::atomic::AtomicBool};
/// Usage: pose MODEL_ROOT VIDEO [START_MS-END_MS ...]: body pose samples as JSON.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().skip(1).collect();
    if a.len() < 2 {
        return Err("Usage: pose MODEL_ROOT VIDEO [START_MS-END_MS ...]".into());
    }
    let windows: Vec<(u32, u32)> = a[2..]
        .iter()
        .filter_map(|w| w.split_once('-').and_then(|(s, e)| Some((s.parse().ok()?, e.parse().ok()?))))
        .collect();
    let samples = supp_media::analysis::pose::run(Path::new(&a[0]), Path::new(&a[1]), &windows, &AtomicBool::new(false), |_| {})?;
    println!("{}", serde_json::to_string(&samples)?);
    Ok(())
}
