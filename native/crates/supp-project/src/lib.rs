//! Versioned project graph and crash-safe local persistence. No media buffers.
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    path::Path,
};
use thiserror::Error;

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
    pub segments: Vec<TranscriptSegment>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptSegment {
    pub id: String,
    pub start_ms: u32,
    pub end_ms: u32,
    pub text: String,
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
    pub kind: String,
    pub name: String,
    pub start: u32,
    pub duration: u32,
    pub source_in: u32,
    pub gain: f64,
    pub transform: Transform,
    #[serde(default)]
    pub crop: Crop,
    pub effects: Effects,
    pub keyframes: Keyframes,
    pub mask: Option<Mask>,
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
fn unique<'a>(ids: impl Iterator<Item = &'a str>) -> bool {
    let mut set = HashSet::new();
    ids.into_iter()
        .all(|id| !id.is_empty() && id.len() <= 128 && set.insert(id))
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
impl Project {
    pub fn validate(&self) -> Result<(), Error> {
        ensure(
            [1, 2, 3].contains(&self.schema_version),
            "Unsupported schema version (expected 1, 2 or 3)",
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
                    if asset.kind != "image" {
                        ensure(
                            c.source_in as f64 + c.duration as f64
                                <= (asset.duration * settings.fps.value()).ceil() + 1.,
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
    p.schema_version = 3;
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
    use super::*;
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
            segments: vec![TranscriptSegment {
                id: "cue".into(),
                start_ms: 0,
                end_ms: 1000,
                text: "Actual caption".into(),
            }],
        });
        p.validate().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested.supp");
        save(&path, &p).unwrap();
        let reopened = read(&path).unwrap();
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
        assert_eq!(reopened.schema_version, 3);
        assert_eq!(reopened.clips[0].transform.scale_x, 1.);
        assert_eq!(
            reopened.clips[0].keyframes.extra["scaleX"][0]
                .out_handle
                .as_ref()
                .unwrap()
                .x,
            0.6
        );
        p.schema_version = 3;
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
        assert_eq!(read(&old).unwrap().schema_version, 3);
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
