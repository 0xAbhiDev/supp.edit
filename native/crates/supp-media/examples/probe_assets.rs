//! Exercise the native ingestion path without opening a file dialog.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut assets = Vec::new();
    for (index, path) in std::env::args().skip(1).enumerate() {
        assets.push(supp_media::inspect(
            std::path::Path::new(&path),
            format!("probe-{index}"),
        )?);
    }
    println!("{}", serde_json::to_string_pretty(&assets)?);
    Ok(())
}
