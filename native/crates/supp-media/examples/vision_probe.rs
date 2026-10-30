//! Usage: vision_probe MODEL_ROOT FIXTURE_DIRECTORY OUTPUT_DIRECTORY DETECTOR_ONNX IMAGE_ENCODER_ONNX
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 5 {
        return Err(
            "Usage: vision_probe MODEL_ROOT FIXTURES OUTPUT DETECTOR_ONNX IMAGE_ENCODER_ONNX"
                .into(),
        );
    }
    let paths: Vec<_> = args.iter().map(std::path::Path::new).collect();
    let report = supp_media::analysis::vision::diagnostics::run(
        paths[0], paths[1], paths[2], paths[3], paths[4],
    )?;
    println!(
        "{}",
        serde_json::json!({"coldStartMs":report["coldStartMs"],"images":report["results"].as_array().map(Vec::len),"output":args[2]})
    );
    Ok(())
}
