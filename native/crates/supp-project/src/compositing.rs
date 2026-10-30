use super::{ensure, Clip, Error, Track};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
pub const BLEND_MODES: [&str; 17] = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
    "add",
];
pub fn normal() -> String {
    "normal".into()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Matte {
    pub layer_id: String,
    pub mode: String,
}
pub fn validate(clips: &[Clip], tracks: &HashMap<&str, &Track>) -> Result<(), Error> {
    let by_id: HashMap<&str, &Clip> = clips.iter().map(|c| (c.id.as_str(), c)).collect();
    for c in clips {
        let visual = c.kind != "null"
            && tracks
                .get(c.track_id.as_str())
                .is_some_and(|t| t.kind == "video");
        ensure(
            BLEND_MODES.contains(&c.blend_mode.as_str()) && (c.blend_mode == "normal" || visual),
            "Invalid blend mode",
        )?;
        if let Some(m) = &c.matte {
            let source = by_id.get(m.layer_id.as_str());
            ensure(
                visual
                    && !m.layer_id.is_empty()
                    && m.layer_id.len() <= 128
                    && ["alpha", "alpha-inverted", "luma", "luma-inverted"]
                        .contains(&m.mode.as_str())
                    && source.is_some_and(|s| {
                        s.kind != "null"
                            && tracks
                                .get(s.track_id.as_str())
                                .is_some_and(|t| t.kind == "video")
                    }),
                "Invalid matte source or mode",
            )?;
            let mut cursor = c;
            let mut visited = HashSet::from([c.id.as_str()]);
            while let Some(m) = &cursor.matte {
                ensure(
                    visited.len() <= 32 && visited.insert(m.layer_id.as_str()),
                    "Cyclic matte or matte depth exceeds 32",
                )?;
                cursor = by_id
                    .get(m.layer_id.as_str())
                    .ok_or_else(|| Error::Invalid("Missing matte source".into()))?;
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{read, save, Project};
    fn project() -> Project {
        let mut p: Project =
            serde_json::from_str(include_str!("../tests/fixtures/parenting-v4.supp")).unwrap();
        p.clips[1].kind = "shape".into();
        p.clips[0].matte = Some(Matte {
            layer_id: p.clips[1].id.clone(),
            mode: "luma-inverted".into(),
        });
        p.clips[0].blend_mode = "soft-light".into();
        p
    }
    #[test]
    fn matte_blend_legacy_migration_and_file_roundtrip() {
        let p = project();
        p.validate().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("matte.supp");
        save(&path, &p).unwrap();
        let read = read(&path).unwrap();
        assert_eq!(read.schema_version, 9);
        assert_eq!(read.clips[0].blend_mode, "soft-light");
        assert_eq!(read.clips[0].matte.as_ref().unwrap().mode, "luma-inverted");
        for mode in BLEND_MODES {
            let mut p = p.clone();
            p.clips[0].blend_mode = mode.into();
            p.validate().unwrap();
        }
    }
    #[test]
    fn rejects_missing_cyclic_cross_scope_and_nonvisual_mattes() {
        let mut p = project();
        p.clips[0].matte.as_mut().unwrap().layer_id = "missing".into();
        assert!(p.validate().is_err());
        let mut p = project();
        p.clips[1].matte = Some(Matte {
            layer_id: p.clips[0].id.clone(),
            mode: "alpha".into(),
        });
        assert!(p
            .validate()
            .unwrap_err()
            .to_string()
            .contains("Cyclic matte"));
        let mut p = project();
        p.clips[0].matte.as_mut().unwrap().layer_id = p.compositions[0].layers[0].id.clone();
        assert!(p.validate().is_err());
        let mut p = project();
        p.clips[1].kind = "null".into();
        assert!(p.validate().is_err());
        let mut p = project();
        p.clips[0].blend_mode = "fake".into();
        assert!(p.validate().is_err());
    }
}
