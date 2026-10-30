//! Real runtime acceptance harness. Never substitutes fixtures for inference.
use std::{path::Path, sync::atomic::AtomicBool};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() == 2 && args[0] == "--install-vision" {
        let state = supp_media::vision_models::install(
            Path::new(&args[1]),
            &AtomicBool::new(false),
            |_| {},
        )?;
        println!("{}", serde_json::to_string_pretty(&state)?);
        return Ok(());
    }
    if args.len() == 2 && args[0] == "--install" {
        let state =
            supp_media::models::install(Path::new(&args[1]), &AtomicBool::new(false), |_| {})?;
        println!("{}", serde_json::to_string_pretty(&state)?);
        return Ok(());
    }
    if args.len() != 5 {
        return Err("Usage: analyze MODEL_ROOT CACHE_ROOT speech|audio|video SOURCE ASSET_ID; or --install MODEL_ROOT".into());
    }
    let task = match args[2].as_str() {
        "speech" => supp_media::analysis::Task::Speech,
        "audio" => supp_media::analysis::Task::Audio,
        "video" => supp_media::analysis::Task::Video,
        "vision" => supp_media::analysis::Task::Vision,
        _ => return Err("Unknown analysis task".into()),
    };
    let result = supp_media::analysis::run(
        Path::new(&args[1]),
        Path::new(&args[0]),
        Path::new(&args[3]),
        &args[4],
        supp_media::analysis::Settings {
            task,
            ..Default::default()
        },
        &AtomicBool::new(false),
        |_| {},
    )?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
