use super::{ensure, range, unique, Error, Handle, Keyframe};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Vertex {
    pub id: String,
    pub x: f64,
    pub y: f64,
    #[serde(rename = "in")]
    pub incoming: Handle,
    #[serde(rename = "out")]
    pub outgoing: Handle,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathKey {
    pub frame: i64,
    pub easing: String,
    pub vertices: Vec<Vertex>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Channels {
    pub opacity: Vec<Keyframe>,
    pub feather: Vec<Keyframe>,
    pub expansion: Vec<Keyframe>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BezierMask {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub mode: String,
    pub inverted: bool,
    pub closed: bool,
    pub vertices: Vec<Vertex>,
    pub opacity: f64,
    pub feather: f64,
    pub expansion: f64,
    pub keyframes: Channels,
    pub path_keys: Vec<PathKey>,
}
fn valid_vertices(vertices: &[Vertex]) -> bool {
    (3..=128).contains(&vertices.len())
        && unique(vertices.iter().map(|v| v.id.as_str()))
        && vertices.iter().all(|v| {
            range(v.x, -4., 5.)
                && range(v.y, -4., 5.)
                && [&v.incoming, &v.outgoing]
                    .iter()
                    .all(|h| range(h.x, -8., 8.) && range(h.y, -8., 8.))
        })
}
pub fn validate(masks: &[BezierMask], visual: bool) -> Result<(), Error> {
    ensure(
        masks.len() <= 32
            && (masks.is_empty() || visual)
            && unique(masks.iter().map(|m| m.id.as_str())),
        "Invalid mask collection",
    )?;
    for m in masks {
        ensure(
            m.name.chars().count() <= 256
                && m.closed
                && ["add", "subtract", "intersect", "difference"].contains(&m.mode.as_str())
                && valid_vertices(&m.vertices)
                && range(m.opacity, 0., 1.)
                && range(m.feather, 0., 256.)
                && range(m.expansion, -512., 512.),
            "Invalid Bezier mask",
        )?;
        for (keys, lo, hi) in [
            (&m.keyframes.opacity, 0., 1.),
            (&m.keyframes.feather, 0., 256.),
            (&m.keyframes.expansion, -512., 512.),
        ] {
            let mut times = HashSet::new();
            ensure(
                keys.len() <= 1000
                    && keys.iter().all(|k| {
                        range(k.value, lo, hi)
                            && (-2_000_000_000..=2_000_000_000).contains(&k.frame)
                            && times.insert(k.frame)
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
                            && [&k.in_handle, &k.out_handle]
                                .into_iter()
                                .flatten()
                                .all(|h| range(h.x, 0., 1.) && range(h.y, -100000., 100000.))
                    }),
                "Invalid mask animation",
            )?;
        }
        let mut times = HashSet::new();
        ensure(
            m.path_keys.len() <= 128
                && m.path_keys.iter().all(|k| {
                    (-2_000_000_000..=2_000_000_000).contains(&k.frame)
                        && times.insert(k.frame)
                        && ["linear", "hold"].contains(&k.easing.as_str())
                        && valid_vertices(&k.vertices)
                        && k.vertices.len() == m.vertices.len()
                        && k.vertices
                            .iter()
                            .zip(&m.vertices)
                            .all(|(a, b)| a.id == b.id)
                }),
            "Invalid animated mask topology",
        )?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{read, save, Project};
    fn mask() -> BezierMask {
        let vertices: Vec<Vertex> = (0..4)
            .map(|i| Vertex {
                id: format!("v{i}"),
                x: if i == 0 || i == 3 { 0.2 } else { 0.8 },
                y: if i < 2 { 0.2 } else { 0.8 },
                incoming: Handle { x: 0., y: 0. },
                outgoing: Handle { x: 0., y: 0. },
            })
            .collect();
        BezierMask {
            id: "mask".into(),
            name: "Animated path".into(),
            enabled: true,
            mode: "subtract".into(),
            inverted: false,
            closed: true,
            path_keys: vec![
                PathKey {
                    frame: -5,
                    easing: "linear".into(),
                    vertices: vertices.clone(),
                },
                PathKey {
                    frame: 45,
                    easing: "hold".into(),
                    vertices: vertices.clone(),
                },
            ],
            vertices,
            opacity: 0.8,
            feather: 12.,
            expansion: -4.,
            keyframes: Channels {
                opacity: vec![],
                feather: vec![Keyframe {
                    frame: 0,
                    value: 10.,
                    easing: "ease-in-out".into(),
                    in_handle: None,
                    out_handle: None,
                }],
                expansion: vec![],
            },
        }
    }
    #[test]
    fn animated_masks_roundtrip_and_v4_migration() {
        let mut project: Project =
            serde_json::from_str(include_str!("../tests/fixtures/parenting-v4.supp")).unwrap();
        assert!(project.clips[0].masks.is_empty());
        project.clips[0].masks.push(mask());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("masks.supp");
        save(&path, &project).unwrap();
        let result = read(&path).unwrap();
        assert_eq!(result.schema_version, 9);
        assert_eq!(
            serde_json::to_value(&result.clips[0].masks).unwrap(),
            serde_json::to_value(&project.clips[0].masks).unwrap()
        );
    }
    #[test]
    fn rejects_invalid_topology_ranges_and_nonvisual_masks() {
        let m = mask();
        validate(std::slice::from_ref(&m), true).unwrap();
        assert!(validate(std::slice::from_ref(&m), false).is_err());
        assert!(validate(&[m.clone(), m.clone()], true).is_err());
        let mut bad = m.clone();
        bad.path_keys[1].vertices.swap(0, 1);
        assert!(validate(&[bad], true).is_err());
        let mut bad = m.clone();
        bad.vertices[0].outgoing.x = f64::NAN;
        assert!(validate(&[bad], true).is_err());
        let mut bad = m.clone();
        bad.keyframes.feather[0].value = 257.;
        assert!(validate(&[bad], true).is_err());
        let mut bad = m.clone();
        bad.path_keys[1].frame = bad.path_keys[0].frame;
        assert!(validate(&[bad], true).is_err());
        let mut bad = m;
        bad.closed = false;
        assert!(validate(&[bad], true).is_err());
    }
}
