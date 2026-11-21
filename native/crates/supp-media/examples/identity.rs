// Where reference frames come from in a raw clip (same-footage identity).
// Usage: identity REFERENCE SOURCE PROBE_MS[,PROBE_MS...] [START-END ...]
// Without windows the whole source is searched (up to 600 s).
use std::sync::atomic::AtomicBool;
use supp_media::analysis::{identity, source_text::Interval};

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        return Err("Usage: identity REFERENCE SOURCE PROBE_MS[,PROBE_MS...] [START-END ...]".into());
    }
    let probes: Vec<u32> = args[2].split(',').filter_map(|v| v.trim().parse().ok()).collect();
    let mut windows: Vec<Interval> = args[3..]
        .iter()
        .filter_map(|w| {
            let (a, b) = w.split_once('-')?;
            Some(serde_json::from_value(serde_json::json!({ "startMs": a.parse::<u32>().ok()?, "endMs": b.parse::<u32>().ok()? })).ok()?)
        })
        .collect();
    if windows.is_empty() {
        windows.push(serde_json::from_value(serde_json::json!({ "startMs": 0, "endMs": 600_000 })).unwrap());
    }
    let started = std::time::Instant::now();
    let hits = identity::run(args[0].as_ref(), &probes, args[1].as_ref(), &windows, &AtomicBool::new(false))?;
    eprintln!("{} probes in {:.2} s", probes.len(), started.elapsed().as_secs_f64());
    println!("{}", serde_json::to_string(&hits).map_err(|e| e.to_string())?);
    Ok(())
}
