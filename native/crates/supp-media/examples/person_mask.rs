use std::{path::Path, sync::atomic::AtomicBool};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().skip(1).collect();
    if a.len() != 2 {
        return Err("Usage: person_mask MODEL_ROOT VIDEO".into());
    }
    let samples = supp_media::analysis::person_mask::run(
        Path::new(&a[0]),
        Path::new(&a[1]),
        &AtomicBool::new(false),
        |_| {},
    )?;
    println!("{}", serde_json::to_string(&samples)?);
    Ok(())
}
