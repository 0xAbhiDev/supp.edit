//! Capture genuine RGB measurements from the repository's licensed media fixture inventory.
use std::{path::PathBuf, sync::atomic::AtomicBool};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let input: serde_json::Value = serde_json::from_slice(&std::fs::read(
        args.get(1)
            .ok_or("Usage: color_samples INVENTORY_JSON OUTPUT_JSON")?,
    )?)?;
    let output = PathBuf::from(args.get(2).ok_or("Missing output")?);
    let root = output.parent().ok_or("Missing output parent")?;
    std::fs::create_dir_all(root)?;
    let cancel = AtomicBool::new(false);
    let mut results = vec![];
    for value in input["assets"].as_array().ok_or("Missing assets")? {
        let asset: supp_project::Asset = serde_json::from_value(value.clone())?;
        if asset.kind != "video" {
            continue;
        }
        let max_seconds = if args.get(3).map(String::as_str) == Some("--reference") {
            300.
        } else {
            3.
        };
        let range = supp_media::analysis::Range {
            start_ms: 0,
            end_ms: (asset.duration.min(max_seconds) * 1000.).floor() as u32,
        };
        results.push(supp_media::analysis::color::run(
            &root.join("color-cache"),
            std::path::Path::new(&asset.path),
            &asset.id,
            range,
            &cancel,
            |_| {},
        )?);
    }
    std::fs::write(output, serde_json::to_vec_pretty(&results)?)?;
    println!(
        "Measured five RGB samples from each of {} real source files",
        results.len()
    );
    Ok(())
}
