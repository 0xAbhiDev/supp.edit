use std::{path::Path, sync::atomic::AtomicBool};
// Usage: source_text VIDEO_PATH START_MS-END_MS [START_MS-END_MS...]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let file = args.next().ok_or("Usage: source_text VIDEO_PATH START_MS-END_MS...")?;
    let intervals: Vec<supp_media::analysis::source_text::Interval> = args
        .map(|a| {
            let (s, e) = a.split_once('-').expect("START_MS-END_MS");
            serde_json::from_str(&format!("{{\"startMs\":{s},\"endMs\":{e}}}")).expect("interval")
        })
        .collect();
    let regions = supp_media::analysis::source_text::run(Path::new(&file), &intervals, &AtomicBool::new(false))?;
    println!("{}", serde_json::to_string(&regions)?);
    Ok(())
}
