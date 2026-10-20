use std::path::PathBuf;
fn main() -> Result<(), String> {
    let source = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Usage: derived_media SOURCE CACHE")?,
    );
    let cache = PathBuf::from(std::env::args().nth(2).ok_or("Cache directory required")?);
    let start = std::time::Instant::now();
    let thumb = supp_media::cache::thumbnail(&cache, &source)?;
    let peaks = supp_media::cache::waveform(&cache, &source)?;
    let first = start.elapsed().as_millis();
    let again = std::time::Instant::now();
    let cached = supp_media::cache::waveform(&cache, &source)?;
    if cached != peaks || !peaks.iter().any(|v| *v > 0.) {
        return Err("Waveform cache/energy validation failed".into());
    }
    println!(
        "{}",
        serde_json::json!({"thumbnail":thumb,"bins":peaks.len(),"peak":peaks.iter().copied().fold(0f32,f32::max),"firstMs":first,"cacheHitMs":again.elapsed().as_millis()})
    );
    Ok(())
}
