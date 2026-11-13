//! Local, sampled visual evidence. Text is a qualified label from measured image/text similarity.
#[path = "vision_diagnostics.rs"]
pub mod diagnostics;
#[path = "vision_runtime.rs"]
pub mod runtime;
#[path = "vision_spec.rs"]
pub mod spec;
#[path = "vision_subjects.rs"]
pub mod subjects;
use super::{check, execute, video::VideoAnalysis};
use crate::{models::Progress, vision_models};
use image::{
    imageops::{self, FilterType},
    RgbImage,
};
use ort::{session::Session, value::Tensor};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{atomic::AtomicBool, Mutex},
};
use supp_project::Asset;
use tokenizers::Tokenizer;

// One runtime/model lease at a time. The application also uses this lease when removing models.
pub static RUNTIME_LEASE: Mutex<()> = Mutex::new(());
const LABELS: &[(&str, &str)] = &[
    ("deadlift", "a person performing a barbell deadlift"),
    ("squat", "a person performing a squat with weights"),
    (
        "bench press",
        "a person lying on a bench pressing a barbell",
    ),
    ("overhead press", "a person pressing weights overhead"),
    ("dumbbell exercise", "a person lifting dumbbells"),
    (
        "kettlebell exercise",
        "a person exercising with kettlebells",
    ),
    ("barbell exercise", "a person lifting a barbell in a gym"),
    ("posing", "a person flexing muscles and posing"),
    ("mirror pose", "a person posing in a gym mirror"),
    (
        "training setup",
        "a person preparing weights before exercising",
    ),
    ("rest", "a person resting between exercises in a gym"),
    ("empty gym", "an empty gym with exercise equipment"),
    ("running", "a person running outdoors"),
    ("talking", "two people talking to each other"),
    ("speaking to camera", "a person speaking to a camera"),
    ("landscape", "an outdoor landscape with mountains and trees"),
    ("coast", "an aerial photograph of the ocean and coastline"),
    ("beach", "a photograph of a sandy beach with waves"),
    ("boat", "an aerial photograph of a boat on blue water"),
    (
        "waterfall",
        "a photograph of a waterfall flowing over rocks",
    ),
    ("forest", "a photograph of a dense green forest"),
    ("mountain", "a photograph of snowy mountains"),
    ("architecture", "a photograph of buildings and architecture"),
    ("cooking", "a person preparing food in a kitchen"),
    ("walking", "a person walking along a path"),
    (
        "travel",
        "a photograph of a scenic road through the countryside",
    ),
    ("street", "cars and people on a city street"),
    ("food", "a close up of food on a plate"),
    ("animal", "a photograph of an animal"),
    ("room", "an indoor room with furniture"),
    ("screen", "a computer screen with text and graphics"),
    ("title", "text and a logo on a plain background"),
    ("abstract", "an abstract pattern of colors"),
    ("dark frame", "a dark black image"),
];
// COCO class vocabulary used by YOLOX (Megvii, Apache-2.0).
const OBJECTS: &[&str] = &[
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "backpack",
    "umbrella",
    "handbag",
    "tie",
    "suitcase",
    "frisbee",
    "skis",
    "snowboard",
    "sports ball",
    "kite",
    "baseball bat",
    "baseball glove",
    "skateboard",
    "surfboard",
    "tennis racket",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
    "chair",
    "couch",
    "potted plant",
    "bed",
    "dining table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell phone",
    "microwave",
    "oven",
    "toaster",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "teddy bear",
    "hair drier",
    "toothbrush",
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Detection {
    pub label: String,
    pub confidence: f32,
    pub bounds: Bounds,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticLabel {
    pub label: String,
    pub similarity: f32,
    pub relative_confidence: f32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisionFrame {
    pub time_ms: u32,
    pub scene_start_ms: u32,
    pub scene_end_ms: u32,
    pub width: u32,
    pub height: u32,
    pub orientation: String,
    pub description: String,
    pub labels: Vec<SemanticLabel>,
    pub detections: Vec<Detection>,
    pub subject: Option<Detection>,
    pub shot_scale: Option<String>,
    pub embedding: Vec<f32>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisionAnalysis {
    pub model_id: String,
    pub model_version: String,
    pub device: String,
    pub frames: Vec<VisionFrame>,
    pub total_scenes: usize,
    pub analyzed_scenes: usize,
    pub method: String,
    pub limitations: Vec<String>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn session(path: &Path) -> Result<Session, String> {
    Ok(runtime::session(path)?.0)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEmbedding {
    pub model_version: String,
    pub processing: &'static str,
    pub embedding: Vec<f32>,
}
pub fn encode_query(
    root: &Path,
    query: &str,
    cancel: &AtomicBool,
) -> Result<QueryEmbedding, String> {
    if query.trim().is_empty() || query.chars().count() > 512 {
        return Err("Search query must contain 1–512 characters".into());
    }
    if !vision_models::status(root).installed {
        return Err("Install the local vision model before embedding a search query".into());
    }
    let _lease = RUNTIME_LEASE.lock().map_err(err)?;
    check(cancel)?;
    ort::init_from(vision_models::runtime(root))
        .map_err(err)?
        .with_name("supp.edit.local-vision")
        .commit();
    let base = vision_models::location(root);
    let tokenizer = Tokenizer::from_file(base.join("tokenizer.json")).map_err(err)?;
    let mut text = session(&base.join("text_model.onnx"))?;
    let embedding = text_embeddings(&mut text, &tokenizer, &[query])?.remove(0);
    check(cancel)?;
    Ok(QueryEmbedding {
        model_version: vision_models::VERSION.into(),
        processing: "LOCAL",
        embedding,
    })
}
fn normalize(values: &[f32]) -> Result<Vec<f32>, String> {
    let norm = values.iter().map(|v| v * v).sum::<f32>().sqrt();
    if !norm.is_finite() || norm < 1e-8 {
        return Err("Invalid vision embedding".into());
    }
    Ok(values.iter().map(|v| v / norm).collect())
}
fn text_embeddings(
    session: &mut Session,
    tokenizer: &Tokenizer,
    texts: &[&str],
) -> Result<Vec<Vec<f32>>, String> {
    let mut tokens = Vec::with_capacity(texts.len() * 77);
    for text in texts {
        let encoding = tokenizer.encode(*text, true).map_err(err)?;
        let mut ids: Vec<i64> = encoding
            .get_ids()
            .iter()
            .take(77)
            .map(|i| i64::from(*i))
            .collect();
        if encoding.len() > 77 {
            ids[76] = 49407;
        }
        ids.resize(77, 0);
        tokens.extend(ids);
    }
    let tensor = Tensor::from_array(([texts.len(), 77], tokens.into_boxed_slice())).map_err(err)?;
    let outputs = session
        .run(ort::inputs!["input_ids" => tensor])
        .map_err(err)?;
    let (_, values) = outputs["text_embeds"]
        .try_extract_tensor::<f32>()
        .map_err(err)?;
    if values.len() != texts.len() * 512 {
        return Err("Unexpected text embedding shape".into());
    }
    values.chunks_exact(512).map(normalize).collect()
}
fn clip_input(rgb: &RgbImage) -> RgbImage {
    let ratio = 256. / rgb.width().min(rgb.height()) as f32;
    let scaled = imageops::resize(
        rgb,
        (rgb.width() as f32 * ratio).round() as u32,
        (rgb.height() as f32 * ratio).round() as u32,
        FilterType::Triangle,
    );
    imageops::crop_imm(
        &scaled,
        (scaled.width() - 256) / 2,
        (scaled.height() - 256) / 2,
        256,
        256,
    )
    .to_image()
}
fn image_embedding(session: &mut Session, rgb: &RgbImage) -> Result<Vec<f32>, String> {
    let crop = clip_input(rgb);
    let mut pixels = vec![0f32; 3 * 256 * 256];
    for (i, p) in crop.pixels().enumerate() {
        for c in 0..3 {
            pixels[c * 256 * 256 + i] = f32::from(p[c]) / 255.;
        }
    }
    let tensor = Tensor::from_array(([1, 3, 256, 256], pixels.into_boxed_slice())).map_err(err)?;
    let outputs = session
        .run(ort::inputs!["pixel_values" => tensor])
        .map_err(err)?;
    let (_, values) = outputs["image_embeds"]
        .try_extract_tensor::<f32>()
        .map_err(err)?;
    if values.len() != 512 {
        return Err("Unexpected image embedding shape".into());
    }
    normalize(values)
}
fn classify(embedding: &[f32], texts: &[Vec<f32>]) -> Vec<SemanticLabel> {
    let scores: Vec<f32> = texts
        .iter()
        .map(|t| t.iter().zip(embedding).map(|(a, b)| a * b).sum())
        .collect();
    let max = scores.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    // This is relative evidence among these candidates, never a calibrated exercise probability.
    let sum = scores.iter().map(|s| ((s - max) * 50.).exp()).sum::<f32>();
    let mut labels: Vec<_> = scores
        .iter()
        .enumerate()
        .map(|(i, s)| SemanticLabel {
            label: LABELS[i].0.into(),
            similarity: *s,
            relative_confidence: ((s - max) * 50.).exp() / sum,
        })
        .collect();
    labels.sort_by(|a, b| b.similarity.total_cmp(&a.similarity));
    labels
}
fn iou(a: &Bounds, b: &Bounds) -> f32 {
    let intersection = (a.x + a.width).min(b.x + b.width) - (a.x.max(b.x));
    let height = (a.y + a.height).min(b.y + b.height) - (a.y.max(b.y));
    let area = intersection.max(0.) * height.max(0.);
    area / (a.width * a.height + b.width * b.height - area).max(1e-8)
}
fn detector_input(rgb: &RgbImage) -> (RgbImage, f32) {
    let ratio = (416. / rgb.width() as f32).min(416. / rgb.height() as f32);
    let scaled = imageops::resize(
        rgb,
        ((rgb.width() as f32 * ratio) as u32).max(1),
        ((rgb.height() as f32 * ratio) as u32).max(1),
        FilterType::Triangle,
    );
    let mut padded = RgbImage::from_pixel(416, 416, image::Rgb([114, 114, 114]));
    imageops::replace(&mut padded, &scaled, 0, 0);
    (padded, ratio)
}
fn detect(session: &mut Session, rgb: &RgbImage) -> Result<Vec<Detection>, String> {
    let (scaled, ratio) = detector_input(rgb);
    let mut pixels = vec![0f32; 3 * 416 * 416];
    for c in 0..3 {
        // The release assets use the NEW preprocessing described in release notes;
        // the source tag's older normalized demo is incompatible with these weights.
        pixels[c * 416 * 416..(c + 1) * 416 * 416].fill(114.);
        for (x, y, p) in scaled.enumerate_pixels() {
            pixels[c * 416 * 416 + y as usize * 416 + x as usize] = f32::from(p[2 - c]);
        }
    }
    let tensor = Tensor::from_array(([1, 3, 416, 416], pixels.into_boxed_slice())).map_err(err)?;
    let outputs = session.run(ort::inputs!["images"=>tensor]).map_err(err)?;
    let (_, values) = outputs["output"].try_extract_tensor::<f32>().map_err(err)?;
    if values.len() != 3549 * 85 {
        return Err("Unexpected object detector shape".into());
    }
    let mut candidates = Vec::new();
    let mut index = 0;
    for stride in [8, 16, 32] {
        let grid = 416 / stride;
        for y in 0..grid {
            for x in 0..grid {
                let row = &values[index * 85..(index + 1) * 85];
                index += 1;
                let Some((class, score)) = row[5..]
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(b.1))
                else {
                    continue;
                };
                let confidence = row[4] * score;
                if !confidence.is_finite() || confidence < 0.3 {
                    continue;
                }
                let cx = (row[0] + x as f32) * stride as f32 / ratio;
                let cy = (row[1] + y as f32) * stride as f32 / ratio;
                let w = row[2].exp() * stride as f32 / ratio;
                let h = row[3].exp() * stride as f32 / ratio;
                if ![cx, cy, w, h].iter().all(|n| n.is_finite()) {
                    continue;
                }
                let left = ((cx - w / 2.) / rgb.width() as f32).clamp(0., 1.);
                let top = ((cy - h / 2.) / rgb.height() as f32).clamp(0., 1.);
                let right = ((cx + w / 2.) / rgb.width() as f32).clamp(0., 1.);
                let bottom = ((cy + h / 2.) / rgb.height() as f32).clamp(0., 1.);
                if right <= left || bottom <= top {
                    continue;
                }
                candidates.push(Detection {
                    label: OBJECTS[class].into(),
                    confidence: confidence.clamp(0., 1.),
                    bounds: Bounds {
                        x: left,
                        y: top,
                        width: right - left,
                        height: bottom - top,
                    },
                });
            }
        }
    }
    candidates.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    let mut kept: Vec<Detection> = Vec::new();
    for candidate in candidates {
        if !kept
            .iter()
            .any(|d| d.label == candidate.label && iou(&d.bounds, &candidate.bounds) > 0.45)
        {
            kept.push(candidate);
            if kept.len() >= 64 {
                break;
            }
        }
    }
    Ok(kept)
}
pub fn analyze(
    source: &Path,
    asset: &Asset,
    model_root: &Path,
    video: &VideoAnalysis,
    cancel: &AtomicBool,
    report: &impl Fn(Progress),
) -> Result<VisionAnalysis, String> {
    if asset.kind != "video" {
        return Err("Vision analysis requires video".into());
    }
    if !vision_models::status(model_root).installed {
        return Err("Install the local vision model pack in AI Studio first".into());
    }
    let _lease = RUNTIME_LEASE.lock().map_err(err)?;
    check(cancel)?;
    ort::init_from(vision_models::runtime(model_root))
        .map_err(err)?
        .with_name("supp.edit.local-vision")
        .commit();
    let base = vision_models::location(model_root);
    let tokenizer = Tokenizer::from_file(base.join("tokenizer.json")).map_err(err)?;
    let (mut text, text_device) = runtime::session(&base.join("text_model.onnx"))?;
    let texts = text_embeddings(
        &mut text,
        &tokenizer,
        &LABELS.iter().map(|l| l.1).collect::<Vec<_>>(),
    )?;
    drop(text);
    let (mut vision, image_device) = runtime::session(&base.join("vision_model.onnx"))?;
    let (mut objects, object_device) = runtime::session(&base.join("yolox_nano.onnx"))?;
    let count = video.scenes.len().min(32);
    let indices: Vec<usize> = (0..count).map(|i| i * video.scenes.len() / count).collect();
    let mut frames = Vec::new();
    for index in indices {
        let scene = &video.scenes[index];
        let mut times = vec![
            scene.start_ms + (scene.end_ms - scene.start_ms) / 4,
            scene.representative_ms,
            scene.start_ms + (scene.end_ms - scene.start_ms) * 3 / 4,
        ];
        times.dedup();
        for time in times {
            check(cancel)?;
            // Bounded JPEG decode respects FFmpeg autorotation and preserves the actual aspect ratio.
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
                        &format!("{:.3}", f64::from(time) / 1000.),
                        "-i",
                    ])
                    .arg(source)
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
            let rgb = image::load_from_memory(&bytes).map_err(err)?.into_rgb8();
            let embedding = image_embedding(&mut vision, &rgb)?;
            check(cancel)?;
            let detections = detect(&mut objects, &rgb)?;
            let labels = classify(&embedding, &texts);
            let subject = detections
                .iter()
                .filter(|d| d.label == "person")
                .max_by(|a, b| {
                    (a.bounds.width * a.bounds.height * a.confidence)
                        .total_cmp(&(b.bounds.width * b.bounds.height * b.confidence))
                })
                .cloned();
            let shot_scale = subject.as_ref().map(|s| {
                if s.bounds.height > 0.85 {
                    "close"
                } else if s.bounds.height > 0.5 {
                    "medium"
                } else {
                    "wide"
                }
                .to_string()
            });
            let strongest = &labels[0];
            let confident = strongest.similarity >= 0.22
                && strongest.relative_confidence >= 0.45
                && strongest.similarity - labels[1].similarity >= 0.015;
            let description = if confident {
                format!(
                    "Likely {}; {} framing",
                    strongest.label,
                    shot_scale.as_deref().unwrap_or("unclassified")
                )
            } else {
                format!("Uncertain scene; closest visual match: {}", strongest.label)
            };
            frames.push(VisionFrame {
                time_ms: time,
                scene_start_ms: scene.start_ms,
                scene_end_ms: scene.end_ms,
                width: rgb.width(),
                height: rgb.height(),
                orientation: if rgb.width() > rgb.height() {
                    "landscape"
                } else if rgb.width() < rgb.height() {
                    "portrait"
                } else {
                    "square"
                }
                .into(),
                description,
                labels,
                detections,
                subject,
                shot_scale,
                embedding,
            });
            report(Progress {
                completed: frames.len() as u64,
                total: (count * 3) as u64,
                unit: "sampled frames",
            });
        }
    }
    let mut providers = vec![
        text_device.active,
        image_device.active,
        object_device.active,
    ];
    providers.sort();
    providers.dedup();
    Ok(VisionAnalysis { model_id:vision_models::MODEL_ID.into(),model_version:vision_models::VERSION.into(),device:providers.join(" + "),frames,total_scenes:video.scenes.len(),analyzed_scenes:count,
        method:"MobileCLIP-S0 fp32 image / quantized text, 512-D normalized embeddings; candidate cosine similarity and relative softmax (temperature 0.02). YOLOX Nano COCO detections, confidence ≥0.30, NMS 0.45. Three representative frames per sampled scene.".into(),
        limitations:vec!["Relative label confidence is not a calibrated probability; uncertain exercise labels require review.".into(),"No face detector, pose/rep phase detector, identity recognition or reliable camera-shake estimator is installed.".into(),"Subject is the largest confidence-weighted detected person in each sample; this is sparse position evidence, not continuous identity tracking.".into(),"At most 32 evenly distributed scenes / 96 frames per asset; unsampled ranges have no semantic evidence.".into()] })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn boxes_and_embeddings_are_measured() {
        let a = Bounds {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
        };
        assert!((iou(&a, &a) - 1.).abs() < 1e-6);
        assert!(normalize(&[0., 0.]).is_err());
        assert_eq!(normalize(&[3., 4.]).unwrap(), vec![0.6, 0.8]);
    }
    #[test]
    fn model_processors_keep_distinct_color_and_geometry_contracts() {
        let image = RgbImage::from_pixel(640, 320, image::Rgb([255, 20, 7]));
        let (detector, ratio) = detector_input(&image);
        assert_eq!(detector.dimensions(), (416, 416));
        assert!((ratio - 0.65).abs() < 1e-6);
        assert_eq!(detector.get_pixel(0, 0).0, [255, 20, 7]);
        assert_eq!(detector.get_pixel(0, 207).0, [255, 20, 7]);
        assert_eq!(detector.get_pixel(0, 208).0, [114, 114, 114]);
        let clip = clip_input(&image);
        assert_eq!(clip.dimensions(), (256, 256));
        assert_eq!(clip.get_pixel(0, 0).0, [255, 20, 7]);
    }
}
