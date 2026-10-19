//! Versioned project graph and crash-safe local persistence. No media buffers.
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::Path};
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub track_id: String,
    pub asset_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub start: u32,
    pub duration: u32,
    pub source_in: u32,
    pub gain: f64,
    pub transform: Transform,
    pub effects: Effects,
    pub keyframes: Keyframes,
    pub mask: Option<Mask>,
    pub text: Text,
    pub shape: Shape,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub rotation: f64,
    pub opacity: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Effects {
    pub blur: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    pub frame: i64,
    pub value: f64,
    pub easing: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframes {
    pub x: Vec<Keyframe>,
    pub y: Vec<Keyframe>,
    pub scale: Vec<Keyframe>,
    pub opacity: Vec<Keyframe>,
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
impl Project {
    pub fn validate(&self) -> Result<(), Error> {
        ensure(
            self.schema_version == 1,
            "Unsupported schema version (expected 1)",
        )?;
        ensure(
            !self.name.is_empty() && self.name.len() <= 1024,
            "Invalid project name",
        )?;
        ensure(
            (64..=8192).contains(&self.settings.width)
                && (64..=8192).contains(&self.settings.height),
            "Dimensions must be 64–8192 pixels",
        )?;
        ensure(
            self.settings.fps.den > 0 && range(self.settings.fps.value(), 1., 120.),
            "Frame rate must be 1–120",
        )?;
        ensure(
            self.settings.color_space == "srgb",
            "Only sRGB processing is implemented",
        )?;
        ensure(
            !self.tracks.is_empty()
                && self.tracks.len() <= 1000
                && self.assets.len() <= 100000
                && self.clips.len() <= 100000,
            "Project graph limits exceeded",
        )?;
        ensure(
            unique(self.assets.iter().map(|x| x.id.as_str()))
                && unique(self.tracks.iter().map(|x| x.id.as_str()))
                && unique(self.clips.iter().map(|x| x.id.as_str()))
                && unique(self.markers.iter().map(|x| x.id.as_str())),
            "Duplicate or invalid graph IDs",
        )?;
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
        for t in &self.tracks {
            ensure(
                ["video", "audio"].contains(&t.kind.as_str()),
                "Invalid track kind",
            )?;
        }
        for c in &self.clips {
            let track = self
                .tracks
                .iter()
                .find(|t| t.id == c.track_id)
                .ok_or_else(|| Error::Invalid("Clip references missing track".into()))?;
            ensure(
                ["media", "text", "shape"].contains(&c.kind.as_str())
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
                    && range(c.transform.rotation, -36000., 36000.),
                "Invalid transform or gain",
            )?;
            ensure(
                range(c.effects.blur, 0., 100.)
                    && range(c.effects.brightness, 0., 3.)
                    && range(c.effects.contrast, 0., 3.)
                    && range(c.effects.saturation, 0., 3.),
                "Invalid effect parameters",
            )?;
            for keys in [
                &c.keyframes.x,
                &c.keyframes.y,
                &c.keyframes.scale,
                &c.keyframes.opacity,
            ] {
                let mut times = HashSet::new();
                ensure(
                    keys.len() <= 10000
                        && keys.iter().all(|k| {
                            range(k.value, -100000., 100000.)
                                && (-2_000_000_000..=2_000_000_000).contains(&k.frame)
                                && ["linear", "hold", "ease-in-out"].contains(&k.easing.as_str())
                                && times.insert(k.frame)
                        }),
                    "Invalid animation",
                )?;
            }
            if c.kind == "media" {
                let asset = self
                    .assets
                    .iter()
                    .find(|a| Some(&a.id) == c.asset_id.as_ref())
                    .ok_or_else(|| Error::Invalid("Clip references missing asset".into()))?;
                ensure(
                    (track.kind == "audio") == (asset.kind == "audio"),
                    "Incompatible track and asset",
                )?;
                if asset.kind != "image" {
                    ensure(
                        c.source_in as f64 + c.duration as f64
                            <= (asset.duration * self.settings.fps.value()).ceil() + 1.,
                        "Clip exceeds source duration",
                    )?;
                }
            } else {
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
    let p: Project = serde_json::from_reader(fs::File::open(path)?)?;
    p.validate()?;
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
