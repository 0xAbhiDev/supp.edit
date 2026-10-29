//! Validate and round-trip a saved project through the native persistence contract.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 { return Err("Usage: verify INPUT.supp OUTPUT.supp".into()); }
    let project = supp_project::read(std::path::Path::new(&args[0]))?;
    supp_project::save(std::path::Path::new(&args[1]), &project)?;
    let reopened = supp_project::read(std::path::Path::new(&args[1]))?;
    if serde_json::to_value(&project)? != serde_json::to_value(&reopened)? { return Err("Native round trip changed project data".into()); }
    println!("{}",serde_json::json!({"schemaVersion":reopened.schema_version,"transcripts":reopened.transcripts.len(),
        "words":reopened.transcripts.iter().flat_map(|t| &t.segments).map(|s| s.words.as_ref().map_or(0,Vec::len)).sum::<usize>(),
        "clips":reopened.clips.len(),"compositions":reopened.compositions.len(),"roundTripIdentical":true}));
    Ok(())
}
