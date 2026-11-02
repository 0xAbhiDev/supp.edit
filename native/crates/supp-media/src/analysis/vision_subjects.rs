//! Dense, range-bounded person evidence for editable camera planning. No project mutation.
use super::*;
use sha2::{Digest, Sha256};
use std::{fs, time::UNIX_EPOCH};
pub const VERSION: &str = "subject-samples-1";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sampling {
    pub start_ms: u32,
    pub end_ms: u32,
    pub interval_ms: u32,
}
impl Sampling {
    fn times(&self, duration: u32) -> Result<Vec<u32>, String> {
        if self.end_ms <= self.start_ms
            || self.end_ms > duration
            || !(100..=1000).contains(&self.interval_ms)
            || self.end_ms - self.start_ms > 300_000
        {
            return Err("Subject sampling needs a valid source range up to 5 minutes and a 100–1000 ms interval".into());
        }
        let mut times: Vec<_> = (self.start_ms..self.end_ms)
            .step_by(self.interval_ms as usize)
            .collect();
        if times.last() != Some(&(self.end_ms - 1)) {
            times.push(self.end_ms - 1);
        }
        if times.len() > 1201 {
            return Err("Subject sampling exceeds 1201 frames; use a shorter range".into());
        }
        Ok(times)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Person {
    pub confidence: f32,
    pub bounds: Bounds,
    /// Measured bright, low-chroma fraction in the inner torso box; not a clothing classifier.
    pub white_torso_fraction: f32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sample {
    pub time_ms: u32,
    pub people: Vec<Person>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubjectSamples {
    pub asset_id: String,
    pub fingerprint: String,
    pub cache_key: String,
    pub algorithm: String,
    pub model_version: String,
    pub processing: String,
    pub device: String,
    pub width: u32,
    pub height: u32,
    pub sampling: Sampling,
    pub samples: Vec<Sample>,
}
fn white_fraction(rgb: &RgbImage, b: &Bounds) -> f32 {
    let x0 = ((b.x + b.width * 0.25) * rgb.width() as f32) as u32;
    let x1 = ((b.x + b.width * 0.75) * rgb.width() as f32) as u32;
    let y0 = ((b.y + b.height * 0.2) * rgb.height() as f32) as u32;
    let y1 = ((b.y + b.height * 0.55) * rgb.height() as f32) as u32;
    let (mut white, mut count) = (0, 0);
    for y in y0..y1.min(rgb.height()) {
        for x in x0..x1.min(rgb.width()) {
            let p = rgb.get_pixel(x, y).0;
            let lo = *p.iter().min().unwrap();
            let hi = *p.iter().max().unwrap();
            count += 1;
            if lo >= 170 && hi - lo <= 35 {
                white += 1;
            }
        }
    }
    white as f32 / count.max(1) as f32
}
#[allow(clippy::too_many_arguments)]
pub fn run(
    cache_root: &Path,
    model_root: &Path,
    source: &Path,
    asset_id: &str,
    sampling: Sampling,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<SubjectSamples, String> {
    check(cancel)?;
    let source = crate::validate_path(source)?;
    let asset = crate::inspect(&source, asset_id.into())?;
    if asset.kind != "video" {
        return Err("Subject sampling requires video".into());
    }
    let times = sampling.times((asset.duration * 1000.).floor() as u32)?;
    let meta = fs::metadata(&source).map_err(err)?;
    let stamp = meta
        .modified()
        .map_err(err)?
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    let key = format!(
        "{:x}",
        Sha256::digest(format!(
            "{VERSION}:{}:{}:{asset_id}:{stamp}:{}",
            vision_models::VERSION,
            asset.fingerprint,
            serde_json::to_string(&sampling).map_err(err)?
        ))
    );
    fs::create_dir_all(cache_root).map_err(err)?;
    let cache = cache_root.join(format!("{key}.json"));
    if cache.metadata().is_ok_and(|m| m.len() <= 16 * 1024 * 1024) {
        if let Ok(data) = fs::read(&cache) {
            if let Ok(result) = serde_json::from_slice::<SubjectSamples>(&data) {
                if result.cache_key == key
                    && result.fingerprint == asset.fingerprint
                    && result.asset_id == asset_id
                {
                    check(cancel)?;
                    report(Progress {
                        completed: times.len() as u64,
                        total: times.len() as u64,
                        unit: "subject samples (cached)",
                    });
                    return Ok(result);
                }
            }
        }
    }
    if !vision_models::status(model_root).installed {
        return Err("Install the local vision model in AI Studio first".into());
    }
    let _lease = RUNTIME_LEASE.lock().map_err(err)?;
    check(cancel)?;
    ort::init_from(vision_models::runtime(model_root))
        .map_err(err)?
        .with_name("supp.edit.local-vision")
        .commit();
    let (mut detector, device) =
        runtime::session(&vision_models::location(model_root).join("yolox_nano.onnx"))?;
    let mut result = SubjectSamples {
        asset_id: asset.id,
        fingerprint: asset.fingerprint,
        cache_key: key,
        algorithm: VERSION.into(),
        model_version: vision_models::VERSION.into(),
        processing: "LOCAL".into(),
        device: device.active,
        width: 0,
        height: 0,
        sampling,
        samples: Vec::new(),
    };
    for time in &times {
        check(cancel)?;
        let bytes = execute(
            crate::command("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-nostdin",
                    "-threads",
                    "2",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-ss",
                    &format!("{:.3}", f64::from(*time) / 1000.),
                    "-i",
                ])
                .arg(&source)
                .args([
                    "-map",
                    "0:v:0",
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=960:960:force_original_aspect_ratio=decrease:out_range=full,format=yuvj420p",
                    "-f",
                    "image2pipe",
                    "-c:v",
                    "mjpeg",
                    "pipe:1",
                ]),
            cancel,
            4 * 1024 * 1024,
        )?;
        // Do not invent a detection when the requested time is past the final packet.
        if bytes.is_empty() {
            continue;
        }
        let rgb = image::load_from_memory(&bytes).map_err(err)?.into_rgb8();
        result.width = rgb.width();
        result.height = rgb.height();
        let people = detect(&mut detector, &rgb)?
            .into_iter()
            .filter(|d| d.label == "person")
            .map(|d| Person {
                white_torso_fraction: white_fraction(&rgb, &d.bounds),
                bounds: d.bounds,
                confidence: d.confidence,
            })
            .collect();
        result.samples.push(Sample {
            time_ms: *time,
            people,
        });
        report(Progress {
            completed: result.samples.len() as u64,
            total: times.len() as u64,
            unit: "subject samples",
        });
    }
    if result.samples.is_empty() {
        return Err("No decoded frames in the requested source range".into());
    }
    check(cancel)?;
    let after = fs::metadata(&source).map_err(err)?;
    if meta.len() != after.len() || meta.modified().ok() != after.modified().ok() {
        return Err("Source changed during subject sampling".into());
    }
    supp_project::atomic_write(&cache, &serde_json::to_vec(&result).map_err(err)?).map_err(err)?;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sampling_bounds_and_endpoints() {
        assert_eq!(
            Sampling {
                start_ms: 100,
                end_ms: 700,
                interval_ms: 250
            }
            .times(1000)
            .unwrap(),
            vec![100, 350, 600, 699]
        );
        for s in [
            Sampling {
                start_ms: 0,
                end_ms: 0,
                interval_ms: 250,
            },
            Sampling {
                start_ms: 0,
                end_ms: 1001,
                interval_ms: 250,
            },
            Sampling {
                start_ms: 0,
                end_ms: 900,
                interval_ms: 0,
            },
        ] {
            assert!(s.times(1000).is_err());
        }
        assert!(Sampling {
            start_ms: 0,
            end_ms: 300_000,
            interval_ms: 100
        }
        .times(300_000)
        .is_err());
    }
    #[test]
    fn torso_evidence_is_measured_color() {
        let b = Bounds {
            x: 0.,
            y: 0.,
            width: 1.,
            height: 1.,
        };
        assert_eq!(
            white_fraction(
                &RgbImage::from_pixel(100, 100, image::Rgb([220, 220, 215])),
                &b
            ),
            1.
        );
        assert_eq!(
            white_fraction(
                &RgbImage::from_pixel(100, 100, image::Rgb([10, 190, 240])),
                &b
            ),
            0.
        );
    }
}
