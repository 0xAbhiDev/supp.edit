fn main() -> Result<(), Box<dyn std::error::Error>> {
    let file = std::env::args().nth(1).ok_or("Usage: aperture VIDEO")?;
    let result = supp_media::analysis::aperture::run(
        std::path::Path::new(&file),
        &std::sync::atomic::AtomicBool::new(false),
        |_| {},
    )?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
