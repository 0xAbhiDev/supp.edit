//! Opt-in development harness. Uses the production processors, tensors, decoder and NMS.
use super::*;
use serde_json::{json, Value};
use std::{fs, time::Instant};
const QUERIES: &[&str] = &[
    "a person",
    "a barbell",
    "a gym",
    "a beach",
    "outdoors",
    "a person lifting weights",
    "a bench press",
    "a dog",
    "a bicycle",
    "a truck",
];
pub fn run(
    root: &Path,
    fixtures: &Path,
    output: &Path,
    detector: &Path,
    encoder: &Path,
) -> Result<Value, String> {
    fs::create_dir_all(output).map_err(err)?;
    let cold = Instant::now();
    ort::init_from(vision_models::runtime(root))
        .map_err(err)?
        .with_name("supp.edit.vision-diagnostics")
        .commit();
    let base = vision_models::location(root);
    let tokenizer = Tokenizer::from_file(base.join("tokenizer.json")).map_err(err)?;
    let (mut text, text_provider) = runtime::session(&base.join("text_model.onnx"))?;
    let (mut vision, image_provider) = runtime::session(encoder)?;
    let (mut objects, detector_provider) = runtime::session(detector)?;
    let cold_ms = cold.elapsed().as_secs_f64() * 1000.;
    let text_start = Instant::now();
    let queries = text_embeddings(&mut text, &tokenizer, QUERIES)?;
    let labels = text_embeddings(
        &mut text,
        &tokenizer,
        &LABELS.iter().map(|l| l.1).collect::<Vec<_>>(),
    )?;
    let text_ms = text_start.elapsed().as_secs_f64() * 1000.;
    let shapes = json!({"imageInputs":format!("{:?}",vision.inputs()),"imageOutputs":format!("{:?}",vision.outputs()),"textInputs":format!("{:?}",text.inputs()),"textOutputs":format!("{:?}",text.outputs()),"detectorInputs":format!("{:?}",objects.inputs()),"detectorOutputs":format!("{:?}",objects.outputs())});
    let mut paths = fs::read_dir(fixtures)
        .map_err(err)?
        .filter_map(Result::ok)
        .map(|f| f.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jpg" || e == "png"))
        .collect::<Vec<_>>();
    paths.sort();
    let mut results = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        let source = image::open(path).map_err(err)?.into_rgb8();
        let ratio = (960. / source.width() as f64)
            .min(960. / source.height() as f64)
            .min(1.);
        let rgb = imageops::resize(
            &source,
            (source.width() as f64 * ratio).round() as u32,
            (source.height() as f64 * ratio).round() as u32,
            FilterType::Triangle,
        );
        rgb.save(output.join(format!("{i}-source.png")))
            .map_err(err)?;
        clip_input(&rgb)
            .save(output.join(format!("{i}-clip-input.png")))
            .map_err(err)?;
        detector_input(&rgb)
            .0
            .save(output.join(format!("{i}-detector-input.png")))
            .map_err(err)?;
        let started = Instant::now();
        let embedding = image_embedding(&mut vision, &rgb)?;
        let embedding_ms = started.elapsed().as_secs_f64() * 1000.;
        let started = Instant::now();
        let detections = detect(&mut objects, &rgb)?;
        let detection_ms = started.elapsed().as_secs_f64() * 1000.;
        let mut overlay = rgb.clone();
        for d in &detections {
            let b = &d.bounds;
            let x = (b.x * rgb.width() as f32) as u32;
            let y = (b.y * rgb.height() as f32) as u32;
            let right = ((b.x + b.width) * rgb.width() as f32) as u32;
            let bottom = ((b.y + b.height) * rgb.height() as f32) as u32;
            let color = if d.label == "person" {
                image::Rgb([0, 255, 100])
            } else {
                image::Rgb([255, 140, 0])
            };
            for thickness in 0..3 {
                for px in x..right.min(rgb.width()) {
                    for py in [y + thickness, bottom.saturating_sub(thickness + 1)] {
                        if py < rgb.height() {
                            overlay.put_pixel(px, py, color);
                        }
                    }
                }
                for py in y..bottom.min(rgb.height()) {
                    for px in [x + thickness, right.saturating_sub(thickness + 1)] {
                        if px < rgb.width() {
                            overlay.put_pixel(px, py, color);
                        }
                    }
                }
            }
        }
        overlay
            .save(output.join(format!("{i}-boxes.png")))
            .map_err(err)?;
        let matches: Vec<_>=queries.iter().zip(QUERIES).map(|(q,s)|json!({"query":s,"cosine":q.iter().zip(&embedding).map(|(a,b)|a*b).sum::<f32>()})).collect();
        results.push(json!({"index":i,"source":path.file_name().unwrap_or_default().to_string_lossy(),"width":rgb.width(),"height":rgb.height(),"embeddingMs":embedding_ms,"detectionMs":detection_ms,"detections":detections,"labels":classify(&embedding,&labels),"queries":matches,"embedding":embedding}));
    }
    let mut providers = vec![
        text_provider.active.clone(),
        image_provider.active.clone(),
        detector_provider.active.clone(),
    ];
    providers.sort();
    providers.dedup();
    let report = json!({"processing":"LOCAL","provider":providers.join(" + "),"providerSelection":{"text":text_provider,"image":image_provider,"detector":detector_provider},"imageModel":encoder.to_string_lossy(),"detector":detector.to_string_lossy(),"textModel":base.join("text_model.onnx").to_string_lossy(),"coldStartMs":cold_ms,"textEncodingMs":text_ms,"specs":[spec::MOBILECLIP,spec::YOLOX],"shapes":shapes,"results":results});
    fs::write(
        output.join("report.json"),
        serde_json::to_vec_pretty(&report).map_err(err)?,
    )
    .map_err(err)?;
    Ok(report)
}
