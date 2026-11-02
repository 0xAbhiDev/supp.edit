//! Versioned project graph and crash-safe local persistence. No media buffers.
pub mod creative;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    path::Path,
};
use thiserror::Error;
pub mod compositing;
pub mod effect_stack;
pub mod masks;
pub mod time_remap;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Project I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid project JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid project: {0}")]
    Invalid(String),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub modified_at: String,
    pub settings: Settings,
    pub assets: Vec<Asset>,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
    pub markers: Vec<Marker>,
    #[serde(default)]
    pub compositions: Vec<Composition>,
    #[serde(default)]
    pub transcripts: Vec<Transcript>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transcript {
    pub id: String,
    pub name: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing_quality: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translated: Option<bool>,
    pub segments: Vec<TranscriptSegment>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptSegment {
    pub id: String,
    pub start_ms: u32,
    pub end_ms: u32,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<TranscriptWord>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptWord {
    pub text: String,
    pub start_ms: u32,
    pub end_ms: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Composition {
    pub id: String,
    pub name: String,
    pub settings: Settings,
    pub duration: u32,
    pub background: String,
    pub tracks: Vec<Track>,
    pub layers: Vec<Clip>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub markers: Vec<Marker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai: Option<creative::AiEditMetadata>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub revisions: Vec<creative::RevisionRecord>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub width: u32,
    pub height: u32,
    pub fps: Rate,
    pub color_space: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rate {
    pub num: u32,
    pub den: u32,
}
impl Rate {
    pub fn value(&self) -> f64 {
        self.num as f64 / self.den as f64
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    pub size: u64,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub has_audio: bool,
    pub fingerprint: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub locked: bool,
    pub hidden: bool,
    pub muted: bool,
    pub solo: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clip {
    pub id: String,
    pub track_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composition_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Canvas affine coefficients [a, b, c, d, e, f], including shear.
    #[serde(default = "identity_affine")]
    pub parent_offset: [f64; 6],
    pub kind: String,
    pub name: String,
    pub start: u32,
    pub duration: u32,
    pub source_in: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_remap: Option<time_remap::TimeRemap>,
    pub gain: f64,
    pub transform: Transform,
    #[serde(default)]
    pub crop: Crop,
    pub effects: Effects,
    #[serde(default)]
    pub effect_stack: Vec<effect_stack::Effect>,
    pub keyframes: Keyframes,
    pub mask: Option<Mask>,
    #[serde(default)]
    pub masks: Vec<masks::BezierMask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matte: Option<compositing::Matte>,
    #[serde(default = "compositing::normal")]
    pub blend_mode: String,
    pub text: Text,
    pub shape: Shape,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub rotation: f64,
    pub opacity: f64,
    #[serde(default = "one")]
    pub scale_x: f64,
    #[serde(default = "one")]
    pub scale_y: f64,
    #[serde(default)]
    pub anchor_x: f64,
    #[serde(default)]
    pub anchor_y: f64,
}
fn one() -> f64 {
    1.
}
fn identity_affine() -> [f64; 6] {
    [1., 0., 0., 1., 0., 0.]
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Crop {
    #[serde(default)]
    pub crop_left: f64,
    #[serde(default)]
    pub crop_top: f64,
    #[serde(default)]
    pub crop_right: f64,
    #[serde(default)]
    pub crop_bottom: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Effects {
    pub blur: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub frame: i64,
    pub value: f64,
    pub easing: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_handle: Option<Handle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out_handle: Option<Handle>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframes {
    #[serde(flatten)]
    pub extra: BTreeMap<String, Vec<Keyframe>>,
    pub x: Vec<Keyframe>,
    pub y: Vec<Keyframe>,
    pub scale: Vec<Keyframe>,
    pub opacity: Vec<Keyframe>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Handle {
    pub x: f64,
    pub y: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mask {
    #[serde(rename = "type")]
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Text {
    pub content: String,
    pub size: f64,
    pub color: String,
    pub font: String,
    pub weight: String,
    pub align: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shape {
    #[serde(rename = "type")]
    pub kind: String,
    pub color: String,
    pub width: f64,
    pub height: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Marker {
    pub id: String,
    pub frame: u32,
    pub name: String,
}

fn ensure(ok: bool, msg: &str) -> Result<(), Error> {
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid(msg.into()))
    }
}
fn range(v: f64, lo: f64, hi: f64) -> bool {
    v.is_finite() && v >= lo && v <= hi
}
fn color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}
/// Opaque project identity. Match JavaScript string length, not UTF-8 byte length.
/// IDs are compared verbatim and never interpreted as paths.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.encode_utf16().count() <= 128
}
fn unique<'a>(ids: impl Iterator<Item = &'a str>) -> bool {
    let mut set = HashSet::new();
    ids.into_iter().all(|id| valid_id(id) && set.insert(id))
}
fn validate_settings(settings: &Settings) -> Result<(), Error> {
    ensure(
        (64..=8192).contains(&settings.width) && (64..=8192).contains(&settings.height),
        "Dimensions must be 64–8192 pixels",
    )?;
    ensure(
        (1..=120000).contains(&settings.fps.num)
            && (1..=10000).contains(&settings.fps.den)
            && range(settings.fps.value(), 1., 120.),
        "Frame rate must be 1–120 with a valid rational rate",
    )?;
    ensure(
        settings.color_space == "srgb",
        "Only sRGB processing is implemented",
    )
}

// Memoized longest-path validation also checks unused compositions. A DAG can
// reuse a source many times, so a global visited set alone cannot bound depth.
fn composition_depth<'a>(
    id: &'a str,
    compositions: &HashMap<&'a str, &'a Composition>,
    visiting: &mut HashSet<&'a str>,
    depths: &mut HashMap<&'a str, usize>,
) -> Result<usize, Error> {
    if let Some(depth) = depths.get(id) {
        return Ok(*depth);
    }
    ensure(visiting.insert(id), "Composition reference cycle")?;
    ensure(
        visiting.len() <= 16,
        "Composition nesting exceeds 16 levels",
    )?;
    let composition = compositions
        .get(id)
        .ok_or_else(|| Error::Invalid("Clip references missing composition".into()))?;
    let mut depth = 1;
    for child in &composition.layers {
        if let Some(child_id) = child.composition_id.as_deref() {
            depth = depth.max(1 + composition_depth(child_id, compositions, visiting, depths)?);
        }
    }
    ensure(depth <= 16, "Composition nesting exceeds 16 levels")?;
    visiting.remove(id);
    depths.insert(id, depth);
    Ok(depth)
}

// Depth counts parent links: an unparented clip has depth zero. Bound the
// active path as well as memoized depths so malformed graphs cannot exhaust
// the stack, and validate every clip regardless of its order or visibility.
fn parent_depth<'a>(
    id: &'a str,
    clips: &HashMap<&'a str, &'a Clip>,
    visiting: &mut HashSet<&'a str>,
    depths: &mut HashMap<&'a str, usize>,
) -> Result<usize, Error> {
    if let Some(depth) = depths.get(id) {
        return Ok(*depth);
    }
    ensure(visiting.insert(id), "Clip parenting cycle")?;
    ensure(visiting.len() <= 65, "Clip parenting exceeds 64 parents")?;
    let clip = clips
        .get(id)
        .ok_or_else(|| Error::Invalid("Clip references missing parent in this scope".into()))?;
    let depth = match clip.parent_id.as_deref() {
        Some(parent) => 1 + parent_depth(parent, clips, visiting, depths)?,
        None => 0,
    };
    ensure(depth <= 64, "Clip parenting exceeds 64 parents")?;
    visiting.remove(id);
    depths.insert(id, depth);
    Ok(depth)
}

fn validate_parenting(clips: &[Clip], tracks: &HashMap<&str, &Track>) -> Result<(), Error> {
    let by_id: HashMap<_, _> = clips.iter().map(|c| (c.id.as_str(), c)).collect();
    for clip in clips {
        ensure(
            clip.parent_offset.iter().all(|v| range(*v, -1e9, 1e9)),
            "Invalid parent offset",
        )?;
        if let Some(id) = clip.parent_id.as_deref() {
            ensure(id != clip.id, "A clip cannot parent itself")?;
            let parent = by_id.get(id).ok_or_else(|| {
                Error::Invalid("Clip references missing parent in this scope".into())
            })?;
            ensure(
                [clip, *parent].iter().all(|c| {
                    tracks
                        .get(c.track_id.as_str())
                        .is_some_and(|t| t.kind == "video")
                }),
                "Parenting requires visual clips on video tracks",
            )?;
        }
    }
    let mut visiting = HashSet::new();
    let mut depths = HashMap::new();
    for clip in clips {
        parent_depth(&clip.id, &by_id, &mut visiting, &mut depths)?;
    }
    Ok(())
}

impl Project {
    pub fn validate(&self) -> Result<(), Error> {
        ensure(
            (1..=10).contains(&self.schema_version),
            "Unsupported schema version (expected versions 1–10)",
        )?;
        ensure(
            !self.name.is_empty() && self.name.len() <= 1024,
            "Invalid project name",
        )?;
        validate_settings(&self.settings)?;
        ensure(
            self.assets.len() <= 100000
                && self.markers.len() <= 100000
                && self.compositions.len() <= 64
                && self.transcripts.len() <= 10000
                && self.clips.len()
                    + self
                        .compositions
                        .iter()
                        .map(|c| c.layers.len())
                        .sum::<usize>()
                    <= 100000,
            "Project graph limits exceeded",
        )?;
        ensure(
            unique(
                std::iter::once(self.id.as_str())
                    .chain(self.assets.iter().map(|x| x.id.as_str()))
                    .chain(self.tracks.iter().map(|x| x.id.as_str()))
                    .chain(self.clips.iter().map(|x| x.id.as_str()))
                    .chain(self.markers.iter().map(|x| x.id.as_str()))
                    .chain(self.transcripts.iter().map(|x| x.id.as_str()))
                    .chain(self.compositions.iter().flat_map(|c| {
                        std::iter::once(c.id.as_str())
                            .chain(c.tracks.iter().map(|t| t.id.as_str()))
                            .chain(c.layers.iter().map(|l| l.id.as_str()))
                            .chain(c.markers.iter().map(|m| m.id.as_str()))
                    })),
            ),
            "Duplicate or invalid graph IDs",
        )?;
        let assets: HashMap<_, _> = self.assets.iter().map(|a| (a.id.as_str(), a)).collect();
        for transcript in &self.transcripts {
            ensure(
                !transcript.name.is_empty()
                    && transcript.name.chars().count() <= 256
                    && ["srt", "transcription"].contains(&transcript.source.as_str())
                    && transcript
                        .language
                        .as_ref()
                        .is_none_or(|l| !l.is_empty() && l.chars().count() <= 64)
                    && transcript
                        .asset_id
                        .as_ref()
                        .is_none_or(|id| assets.contains_key(id.as_str()))
                    && !transcript.segments.is_empty()
                    && transcript.segments.len() <= 10000
                    && transcript
                        .model_id
                        .as_ref()
                        .is_none_or(|s| !s.is_empty() && s.len() <= 128)
                    && transcript
                        .model_version
                        .as_ref()
                        .is_none_or(|s| !s.is_empty() && s.len() <= 128)
                    && transcript
                        .source_fingerprint
                        .as_ref()
                        .is_none_or(|s| !s.is_empty() && s.chars().count() <= 8192)
                    && transcript
                        .timing_quality
                        .as_ref()
                        .is_none_or(|s| ["imported", "approximate"].contains(&s.as_str()))
                    && transcript
                        .segments
                        .iter()
                        .map(|s| s.words.as_ref().map_or(0, Vec::len))
                        .sum::<usize>()
                        <= 100000
                    && unique(transcript.segments.iter().map(|s| s.id.as_str())),
                "Invalid transcript metadata",
            )?;
            let mut previous = 0;
            for segment in &transcript.segments {
                ensure(
                    segment.start_ms >= previous
                        && segment.end_ms > segment.start_ms
                        && segment.end_ms <= 604_800_000
                        && !segment.text.is_empty()
                        && segment.text.chars().count() <= 10000,
                    "Invalid transcript segment",
                )?;
                previous = segment.start_ms;
                ensure(
                    segment
                        .speaker_id
                        .as_ref()
                        .is_none_or(|s| !s.is_empty() && s.len() <= 128),
                    "Invalid speaker ID",
                )?;
                let mut previous_word = segment.start_ms;
                if let Some(words) = &segment.words {
                    ensure(words.len() <= 10000, "Too many words in segment")?;
                    for word in words {
                        ensure(
                            word.start_ms >= previous_word
                                && word.end_ms >= word.start_ms
                                && word.end_ms <= segment.end_ms
                                && !word.text.is_empty()
                                && word.text.chars().count() <= 1000
                                && word
                                    .confidence
                                    .is_none_or(|c| c.is_finite() && (0. ..=1.).contains(&c))
                                && word
                                    .speaker_id
                                    .as_ref()
                                    .is_none_or(|s| !s.is_empty() && s.len() <= 128),
                            "Invalid transcript word",
                        )?;
                        previous_word = word.start_ms;
                    }
                }
            }
        }
        let compositions: HashMap<_, _> = self
            .compositions
            .iter()
            .map(|c| (c.id.as_str(), c))
            .collect();
        for c in &self.compositions {
            validate_settings(&c.settings)?;
            ensure(
                !c.name.is_empty()
                    && c.name.len() <= 1024
                    && (1..=2_000_000_000).contains(&c.duration)
                    && (c.background == "transparent" || color(&c.background)),
                "Invalid composition metadata",
            )?;
            ensure(
                c.markers.len() <= 10000
                    && c.markers
                        .iter()
                        .all(|m| m.frame <= 2_000_000_000 && m.name.chars().count() <= 256),
                "Invalid composition markers",
            )?;
            if let Some(ai) = &c.ai {
                ai.validate()?;
            }
            ensure(c.revisions.len() <= 100, "Too many sequence revisions")?;
            for revision in &c.revisions {
                revision.validate()?;
            }
        }
        for a in &self.assets {
            ensure(
                ["video", "audio", "image"].contains(&a.kind.as_str())
                    && range(a.duration, 0., 604800.)
                    && range(a.fps, 0., 1000.)
                    && (a.kind == "audio"
                        || (a.width > 0 && a.height > 0 && a.width <= 65536 && a.height <= 65536))
                    && a.path.len() <= 32768,
                "Invalid media asset",
            )?;
        }
        for (settings, scene_tracks, scene_clips) in
            std::iter::once((&self.settings, &self.tracks, &self.clips)).chain(
                self.compositions
                    .iter()
                    .map(|c| (&c.settings, &c.tracks, &c.layers)),
            )
        {
            ensure(
                !scene_tracks.is_empty() && scene_tracks.len() <= 1000,
                "Invalid composition track count",
            )?;
            let tracks: HashMap<_, _> = scene_tracks.iter().map(|t| (t.id.as_str(), t)).collect();
            for t in scene_tracks {
                ensure(
                    ["video", "audio"].contains(&t.kind.as_str()),
                    "Invalid track kind",
                )?;
            }
            for c in scene_clips {
                let track = tracks
                    .get(c.track_id.as_str())
                    .ok_or_else(|| Error::Invalid("Clip references missing track".into()))?;
                ensure(
                    ["media", "text", "shape", "composition", "null"].contains(&c.kind.as_str())
                        && c.source_in <= 2_000_000_000
                        && c.duration > 0
                        && c.start
                            .checked_add(c.duration)
                            .is_some_and(|v| v <= 2_000_000_000),
                    "Invalid clip timing or kind",
                )?;
                ensure(
                    range(c.gain, -60., 12.)
                        && range(c.transform.scale, 0.01, 10.)
                        && range(c.transform.opacity, 0., 1.)
                        && range(c.transform.x, -32768., 32768.)
                        && range(c.transform.y, -32768., 32768.)
                        && range(c.transform.rotation, -36000., 36000.)
                        && range(c.transform.scale_x, 0.01, 10.)
                        && range(c.transform.scale_y, 0.01, 10.)
                        && range(c.transform.anchor_x, -32768., 32768.)
                        && range(c.transform.anchor_y, -32768., 32768.),
                    "Invalid transform or gain",
                )?;
                ensure(
                    range(c.effects.blur, 0., 100.)
                        && range(c.effects.brightness, 0., 3.)
                        && range(c.effects.contrast, 0., 3.)
                        && range(c.effects.saturation, 0., 3.),
                    "Invalid effect parameters",
                )?;
                ensure(
                    [
                        c.crop.crop_left,
                        c.crop.crop_top,
                        c.crop.crop_right,
                        c.crop.crop_bottom,
                    ]
                    .iter()
                    .all(|v| range(*v, 0., 1.)),
                    "Invalid crop",
                )?;
                ensure(
                    c.keyframes.extra.keys().all(|k| {
                        [
                            "rotation",
                            "scaleX",
                            "scaleY",
                            "anchorX",
                            "anchorY",
                            "blur",
                            "brightness",
                            "contrast",
                            "saturation",
                            "cropLeft",
                            "cropTop",
                            "cropRight",
                            "cropBottom",
                        ]
                        .contains(&k.as_str())
                    }),
                    "Unknown animation channel",
                )?;
                for keys in [
                    &c.keyframes.x,
                    &c.keyframes.y,
                    &c.keyframes.scale,
                    &c.keyframes.opacity,
                ]
                .into_iter()
                .chain(c.keyframes.extra.values())
                {
                    let mut times = HashSet::new();
                    ensure(
                        keys.len() <= 10000
                            && keys.iter().all(|k| {
                                range(k.value, -100000., 100000.)
                                    && (-2_000_000_000..=2_000_000_000).contains(&k.frame)
                                    && [
                                        "linear",
                                        "hold",
                                        "ease-in",
                                        "ease-out",
                                        "ease-in-out",
                                        "bezier",
                                        "auto-bezier",
                                        "continuous-bezier",
                                    ]
                                    .contains(&k.easing.as_str())
                                    && [&k.in_handle, &k.out_handle].into_iter().flatten().all(
                                        |h| range(h.x, 0., 1.) && range(h.y, -100000., 100000.),
                                    )
                                    && times.insert(k.frame)
                            }),
                        "Invalid animation",
                    )?;
                }
                if let Some(map) = &c.time_remap {
                    map.validate()?;
                    ensure(
                        c.kind == "media",
                        "Speed ramps require a video or audio source",
                    )?;
                    ensure(
                        c.duration as f64 / settings.fps.value() <= 300.
                            && (c.source_frame(c.duration as f64) - c.source_frame(0.))
                                / settings.fps.value()
                                <= 300.,
                        "Speed remapping supports up to 5 minutes",
                    )?;
                }
                if c.kind == "media" {
                    ensure(
                        c.composition_id.is_none(),
                        "Media layers cannot reference compositions",
                    )?;
                    let asset = c
                        .asset_id
                        .as_deref()
                        .and_then(|id| assets.get(id))
                        .ok_or_else(|| Error::Invalid("Clip references missing asset".into()))?;
                    ensure(
                        (track.kind == "audio") == (asset.kind == "audio"),
                        "Incompatible track and asset",
                    )?;
                    ensure(
                        c.time_remap.is_none() || asset.kind != "image",
                        "Speed ramps require a video or audio source",
                    )?;
                    if asset.kind != "image" {
                        ensure(
                            c.source_frame(c.duration as f64)
                                <= if c.time_remap.is_some() {
                                    asset.duration * settings.fps.value() + 1e-7
                                } else {
                                    (asset.duration * settings.fps.value()).ceil() + 1.
                                },
                            "Clip exceeds source duration",
                        )?;
                    }
                } else {
                    ensure(
                        c.asset_id.is_none(),
                        "Generated layers cannot reference media assets",
                    )?;
                    if c.kind == "composition" {
                        ensure(
                            c.composition_id
                                .as_deref()
                                .is_some_and(|id| compositions.contains_key(id)),
                            "Clip references missing composition",
                        )?;
                        let source = compositions[c.composition_id.as_deref().unwrap()];
                        ensure(
                            (c.source_in as f64 + c.duration as f64) / settings.fps.value()
                                <= source.duration as f64 / source.settings.fps.value() + 1e-8,
                            "Layer exceeds composition duration",
                        )?;
                    } else {
                        ensure(
                            c.composition_id.is_none(),
                            "Only composition layers can reference compositions",
                        )?;
                    }
                    ensure(
                        track.kind == "video",
                        "Generated layers require a video track",
                    )?;
                }
                masks::validate(&c.masks, track.kind == "video" && c.kind != "null")?;
                effect_stack::validate(&c.effect_stack, track.kind == "video" && c.kind != "null")?;
                if let Some(m) = &c.mask {
                    ensure(
                        ["rectangle", "ellipse"].contains(&m.kind.as_str())
                            && range(m.x, 0., 1.)
                            && range(m.y, 0., 1.)
                            && range(m.width, 0.001, 1.)
                            && range(m.height, 0.001, 1.),
                        "Invalid mask",
                    )?;
                }
                ensure(
                    c.text.content.len() <= 40000
                        && range(c.text.size, 6., 1000.)
                        && range(c.shape.width, 1., 8192.)
                        && range(c.shape.height, 1., 8192.),
                    "Invalid text or shape",
                )?;
                ensure(
                    color(&c.text.color)
                        && color(&c.shape.color)
                        && ["sans-serif", "serif", "monospace"].contains(&c.text.font.as_str())
                        && ["normal", "bold"].contains(&c.text.weight.as_str())
                        && ["left", "center", "right"].contains(&c.text.align.as_str())
                        && ["rectangle", "ellipse"].contains(&c.shape.kind.as_str()),
                    "Invalid typography or shape style",
                )?;
            }
            validate_parenting(scene_clips, &tracks)?;
            compositing::validate(scene_clips, &tracks)?;
        }
        let mut visiting = HashSet::new();
        let mut depths = HashMap::new();
        for id in compositions.keys() {
            composition_depth(id, &compositions, &mut visiting, &mut depths)?;
        }
        Ok(())
    }
    pub fn duration(&self) -> u32 {
        self.clips
            .iter()
            .map(|c| c.start.saturating_add(c.duration))
            .max()
            .unwrap_or(0)
    }
}
pub fn read(path: &Path) -> Result<Project, Error> {
    ensure(
        fs::metadata(path)?.len() <= 64 * 1024 * 1024,
        "Project exceeds 64 MiB limit",
    )?;
    let mut p: Project = serde_json::from_reader(fs::File::open(path)?)?;
    p.validate()?;
    p.schema_version = 10;
    Ok(p)
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::Invalid("Destination has no parent".into()))?;
    fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| Error::Io(e.error))?;
    Ok(())
}
pub fn save(path: &Path, project: &Project) -> Result<(), Error> {
    project.validate()?;
    let bytes = serde_json::to_vec_pretty(project)?;
    if path.exists() {
        let backup = path.with_extension("supp.bak");
        atomic_write(&backup, &fs::read(path)?)?;
    }
    atomic_write(path, &bytes)
}
#[cfg(test)]
mod tests {
    #[test]
    fn identity_contract_accepts_opaque_unicode_ids_and_rejects_invalid_lengths() {
        for id in [
            "legacy-asset",
            "a/b",
            "素材",
            "123",
            "f5fcbef6-d7c1-420b-8d16-b82c57baf170",
        ] {
            assert!(super::valid_id(id));
        }
        assert!(super::valid_id(&"素".repeat(128)));
        assert!(super::valid_id(&"🖼".repeat(64)));
        assert!(!super::valid_id(""));
        assert!(!super::valid_id(&"x".repeat(129)));
        assert!(!super::valid_id(&"🖼".repeat(65)));
    }
    use super::*;

    fn parenting_project() -> Project {
        serde_json::from_str(include_str!("../tests/fixtures/parenting-v4.supp")).unwrap()
    }

    fn scope_clips(project: &mut Project, nested: bool) -> &mut Vec<Clip> {
        if nested {
            &mut project.compositions[0].layers
        } else {
            &mut project.clips
        }
    }

    fn assert_invalid_parenting(project: &Project, message: &str) {
        let error = project.validate().unwrap_err().to_string();
        assert!(error.contains(message), "{error}");
        // Exercise the file reader too: invalid serialized graphs must fail
        // before migration rather than being silently repaired or accepted.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("invalid.supp");
        fs::write(&path, serde_json::to_vec(project).unwrap()).unwrap();
        let error = read(&path).unwrap_err().to_string();
        assert!(error.contains(message), "{error}");
    }

    #[test]
    fn parenting_v4_serde_and_file_roundtrip_preserve_affine_offsets() {
        let project = parenting_project();
        project.validate().unwrap();
        assert_eq!(
            project.clips[0].parent_id.as_deref(),
            Some("root-controller")
        );
        assert_eq!(
            project.clips[0].parent_offset,
            [1.2, 0.35, -0.2, 0.8, 42., -17.]
        );
        assert_eq!(project.clips[1].kind, "null");
        assert_eq!(project.clips[1].parent_id, None);
        assert_eq!(project.clips[1].parent_offset, identity_affine());
        assert_eq!(project.compositions[0].layers[1].kind, "null");
        assert_eq!(
            project.compositions[0].layers[0].parent_offset,
            [0.9, -0.15, 0.4, 1.1, -8., 12.]
        );

        let value = serde_json::to_value(&project).unwrap();
        assert!(value["clips"][1].get("parentId").is_none());
        assert!(value["compositions"][0]["layers"][1]
            .get("parentId")
            .is_none());
        assert_eq!(
            value["clips"][1]["parentOffset"],
            serde_json::json!([1., 0., 0., 1., 0., 0.])
        );
        let decoded: Project =
            serde_json::from_str(&serde_json::to_string(&project).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), value);
        let mut value = value;
        value["schemaVersion"] = 10.into();

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("parenting.supp");
        fs::write(&path, include_str!("../tests/fixtures/parenting-v4.supp")).unwrap();
        let reopened = read(&path).unwrap();
        assert_eq!(reopened.schema_version, 10);
        assert_eq!(serde_json::to_value(&reopened).unwrap(), value);
        save(&path, &reopened).unwrap();
        assert_eq!(serde_json::to_value(read(&path).unwrap()).unwrap(), value);
    }

    #[test]
    fn versions_one_through_four_migrate_with_parenting_and_legacy_defaults() {
        let dir = tempfile::tempdir().unwrap();
        for version in 1..=4 {
            let source = match version {
                1 | 2 => include_str!("../../../../tests/fixtures/animation.supp"),
                3 => include_str!("../tests/fixtures/compositor-v3.supp"),
                _ => include_str!("../tests/fixtures/parenting-v4.supp"),
            };
            let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
            value["schemaVersion"] = version.into();
            fn remove_optional_fields(clips: &mut serde_json::Value) {
                for clip in clips.as_array_mut().unwrap() {
                    let fields = clip.as_object_mut().unwrap();
                    fields.remove("parentId");
                    fields.remove("parentOffset");
                    fields.remove("crop");
                    let transform = fields["transform"].as_object_mut().unwrap();
                    for key in ["scaleX", "scaleY", "anchorX", "anchorY"] {
                        transform.remove(key);
                    }
                }
            }
            remove_optional_fields(&mut value["clips"]);
            if let Some(compositions) = value
                .get_mut("compositions")
                .and_then(serde_json::Value::as_array_mut)
            {
                for composition in compositions {
                    remove_optional_fields(&mut composition["layers"]);
                }
            }
            let original = serde_json::to_vec(&value).unwrap();
            let path = dir.path().join(format!("v{version}.supp"));
            fs::write(&path, &original).unwrap();
            let reopened = read(&path).unwrap();
            assert_eq!(reopened.schema_version, 10);
            assert_eq!(fs::read(&path).unwrap(), original);
            for clip in reopened
                .clips
                .iter()
                .chain(reopened.compositions.iter().flat_map(|c| &c.layers))
            {
                assert_eq!(clip.parent_id, None);
                assert_eq!(clip.parent_offset, identity_affine());
                assert_eq!((clip.transform.scale_x, clip.transform.scale_y), (1., 1.));
                assert_eq!((clip.transform.anchor_x, clip.transform.anchor_y), (0., 0.));
                assert_eq!(
                    [
                        clip.crop.crop_left,
                        clip.crop.crop_top,
                        clip.crop.crop_right,
                        clip.crop.crop_bottom
                    ],
                    [0.; 4]
                );
            }
            if version < 3 {
                assert!(reopened.compositions.is_empty());
                assert!(reopened.transcripts.is_empty());
            }
        }
    }

    #[test]
    fn parenting_rejects_missing_self_and_cross_scope_references() {
        for nested in [false, true] {
            for invalid_parent in ["missing", "", "audio-asset", "nested-source", "root-video"] {
                let mut project = parenting_project();
                scope_clips(&mut project, nested)[0].parent_id = Some(invalid_parent.into());
                assert_invalid_parenting(&project, "missing parent in this scope");
            }
            let mut project = parenting_project();
            let clips = scope_clips(&mut project, nested);
            clips[0].parent_id = Some(clips[0].id.clone());
            assert_invalid_parenting(&project, "cannot parent itself");

            let mut project = parenting_project();
            scope_clips(&mut project, nested)[0].parent_id = Some(
                if nested {
                    "root-controller"
                } else {
                    "nested-controller"
                }
                .into(),
            );
            assert_invalid_parenting(&project, "missing parent in this scope");
        }
        let mut project = parenting_project();
        let mut sibling = project.compositions[0].clone();
        sibling.id = "sibling-source".into();
        sibling.tracks[0].id = "sibling-video".into();
        sibling.layers.truncate(1);
        sibling.layers[0].id = "sibling-child".into();
        sibling.layers[0].track_id = "sibling-video".into();
        // This ID exists in another composition, but not the sibling's scope.
        project.compositions.push(sibling);
        assert_invalid_parenting(&project, "missing parent in this scope");
    }

    #[test]
    fn parenting_rejects_cycles_including_unused_compositions() {
        for nested in [false, true] {
            for length in [2, 3] {
                let mut project = parenting_project();
                if nested {
                    project.clips.clear();
                }
                let clips = scope_clips(&mut project, nested);
                if length == 2 {
                    clips[1].parent_id = Some(clips[0].id.clone());
                } else {
                    let mut third = clips[1].clone();
                    third.id = "third-controller".into();
                    third.parent_id = Some(clips[0].id.clone());
                    clips[1].parent_id = Some(third.id.clone());
                    clips.push(third);
                }
                assert_invalid_parenting(&project, "parenting cycle");
            }
        }
    }

    #[test]
    fn parenting_requires_visual_parent_and_child_in_each_scope() {
        for nested in [false, true] {
            let mut base = parenting_project();
            if nested {
                let mut track = base.tracks[1].clone();
                track.id = "nested-audio-track".into();
                let mut audio = base.clips[2].clone();
                audio.id = "nested-audio-clip".into();
                audio.track_id = track.id.clone();
                base.compositions[0].tracks.push(track);
                base.compositions[0].layers.push(audio);
            }
            base.validate().unwrap();
            for audio_is_parent in [false, true] {
                let mut project = base.clone();
                let clips = scope_clips(&mut project, nested);
                if audio_is_parent {
                    clips[0].parent_id = Some(clips[2].id.clone());
                } else {
                    clips[2].parent_id = Some(clips[1].id.clone());
                }
                assert_invalid_parenting(&project, "requires visual clips");
            }
        }
    }

    #[test]
    fn parenting_depth_allows_64_parents_and_rejects_65_in_any_order() {
        for nested in [false, true] {
            for reverse in [false, true] {
                let mut project = parenting_project();
                let template = scope_clips(&mut project, nested)[1].clone();
                let clips = scope_clips(&mut project, nested);
                *clips = (0..=64)
                    .map(|index| {
                        let mut clip = template.clone();
                        clip.id = format!("chain-{index}");
                        clip.parent_id = (index > 0).then(|| format!("chain-{}", index - 1));
                        clip
                    })
                    .collect();
                if reverse {
                    clips.reverse();
                }
                project.validate().unwrap();
                let mut extra = template;
                extra.id = "chain-65".into();
                extra.parent_id = Some("chain-64".into());
                let clips = scope_clips(&mut project, nested);
                if reverse {
                    clips.insert(0, extra);
                } else {
                    clips.push(extra);
                }
                assert_invalid_parenting(&project, "exceeds 64 parents");
            }
        }
    }

    #[test]
    fn parent_offsets_require_six_finite_bounded_coefficients() {
        for nested in [false, true] {
            for index in 0..6 {
                for valid in [-1e9, 0., 1e9] {
                    let mut project = parenting_project();
                    scope_clips(&mut project, nested)[0].parent_offset[index] = valid;
                    project.validate().unwrap();
                }
                for invalid in [-1e9 - 1., 1e9 + 1.] {
                    let mut project = parenting_project();
                    scope_clips(&mut project, nested)[0].parent_offset[index] = invalid;
                    assert_invalid_parenting(&project, "Invalid parent offset");
                }
                for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
                    let mut project = parenting_project();
                    scope_clips(&mut project, nested)[0].parent_offset[index] = invalid;
                    assert!(project
                        .validate()
                        .unwrap_err()
                        .to_string()
                        .contains("Invalid parent offset"));
                }
            }
            // Unparented clips still carry and validate their offset.
            let mut project = parenting_project();
            scope_clips(&mut project, nested)[1].parent_offset[4] = 1e9 + 1.;
            assert_invalid_parenting(&project, "Invalid parent offset");
        }
        for invalid in [
            serde_json::json!([1, 0, 0, 1, 0]),
            serde_json::json!([1, 0, 0, 1, 0, 0, 0]),
            serde_json::json!([1, 0, 0, 1, 0, null]),
            serde_json::json!([1, 0, 0, 1, 0, "1"]),
            serde_json::Value::Null,
        ] {
            let mut value = serde_json::to_value(parenting_project()).unwrap();
            value["clips"][0]["parentOffset"] = invalid;
            assert!(serde_json::from_str::<Project>(&value.to_string()).is_err());
        }
    }

    #[test]
    fn compositions_transcripts_roundtrip_and_cycles() {
        let mut p: Project =
            serde_json::from_str(include_str!("../tests/fixtures/compositor-v3.supp")).unwrap();
        p.transcripts.push(Transcript {
            id: "transcript".into(),
            name: "Imported SRT".into(),
            source: "srt".into(),
            language: None,
            asset_id: None,
            source_fingerprint: None,
            model_id: None,
            model_version: None,
            timing_quality: None,
            translated: None,
            segments: vec![TranscriptSegment {
                id: "cue".into(),
                start_ms: 0,
                end_ms: 1000,
                text: "Actual caption".into(),
                speaker_id: None,
                words: None,
            }],
        });
        p.validate().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested.supp");
        save(&path, &p).unwrap();
        let reopened = read(&path).unwrap();
        p.schema_version = 10;
        assert_eq!(
            serde_json::to_value(&p).unwrap(),
            serde_json::to_value(reopened).unwrap()
        );
        p.transcripts[0].segments[0].end_ms = 0;
        assert!(p.validate().is_err());
        p.transcripts[0].segments[0].end_ms = 1000;
        let mut cycle = p.clips[0].clone();
        cycle.id = "cycle".into();
        cycle.track_id = p.compositions[0].tracks[0].id.clone();
        cycle.duration = 24;
        cycle.source_in = 0;
        p.compositions[0].layers.push(cycle);
        assert!(p.validate().unwrap_err().to_string().contains("cycle"));
    }
    #[test]
    fn animation_v2_contract_and_legacy_migration() {
        let mut p: Project =
            serde_json::from_str(include_str!("../../../../tests/fixtures/animation.supp"))
                .unwrap();
        p.validate().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("animation.supp");
        save(&path, &p).unwrap();
        let reopened = read(&path).unwrap();
        assert_eq!(reopened.schema_version, 10);
        assert_eq!(reopened.clips[0].transform.scale_x, 1.);
        assert_eq!(
            reopened.clips[0].keyframes.extra["scaleX"][0]
                .out_handle
                .as_ref()
                .unwrap()
                .x,
            0.6
        );
        p.schema_version = 10;
        assert_eq!(
            serde_json::to_value(&p).unwrap(),
            serde_json::to_value(reopened).unwrap()
        );
        p.clips[0].keyframes.extra.get_mut("scaleX").unwrap()[0]
            .out_handle
            .as_mut()
            .unwrap()
            .x = 2.;
        assert!(p.validate().is_err());
        let old = dir.path().join("old.supp");
        fs::write(
            &old,
            include_str!("../../../../tests/fixtures/project.supp"),
        )
        .unwrap();
        assert_eq!(read(&old).unwrap().schema_version, 10);
        assert!(fs::read_to_string(old)
            .unwrap()
            .contains("\"schemaVersion\":1"));
    }
    #[test]
    fn atomic_replace_preserves_previous_until_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.supp");
        atomic_write(&path, b"old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"new");
    }
    #[test]
    fn rejects_unknown_version() {
        let p: Project =
            serde_json::from_str(include_str!("../../../../tests/fixtures/project.supp")).unwrap();
        let mut p = p;
        p.schema_version = 99;
        assert!(p.validate().is_err());
    }
    #[test]
    fn round_trip_and_backup() {
        let p: Project =
            serde_json::from_str(include_str!("../../../../tests/fixtures/project.supp")).unwrap();
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("test.supp");
        save(&path, &p).unwrap();
        let mut second = p.clone();
        second.name = "Changed".into();
        save(&path, &second).unwrap();
        assert_eq!(read(&path).unwrap().name, "Changed");
        assert_eq!(read(&path.with_extension("supp.bak")).unwrap().name, p.name);
    }
}
