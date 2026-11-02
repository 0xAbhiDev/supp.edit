//! Runs actual local person sampling for a bounded source range.
use std::{path::Path, sync::atomic::AtomicBool};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 7 {
        return Err(
            "Usage: subjects MODEL_ROOT CACHE_ROOT SOURCE ASSET_ID START_MS END_MS INTERVAL_MS"
                .into(),
        );
    }
    let result = supp_media::analysis::vision::subjects::run(
        Path::new(&args[1]),
        Path::new(&args[0]),
        Path::new(&args[2]),
        &args[3],
        supp_media::analysis::vision::subjects::Sampling {
            start_ms: args[4].parse()?,
            end_ms: args[5].parse()?,
            interval_ms: args[6].parse()?,
        },
        &AtomicBool::new(false),
        |_| {},
    )?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
