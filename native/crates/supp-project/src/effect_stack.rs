use super::{ensure, range, unique, Error, Keyframe};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Effect {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub enabled: bool,
    pub value: f64,
    #[serde(default)]
    pub keys: Vec<Keyframe>,
}
pub fn validate(stack: &[Effect], visual: bool) -> Result<(), Error> {
    ensure(
        stack.len() <= 32
            && (stack.is_empty() || visual)
            && unique(stack.iter().map(|e| e.id.as_str())),
        "Invalid effect stack",
    )?;
    for e in stack {
        ensure(
            ["blur", "brightness", "contrast", "saturation"].contains(&e.kind.as_str()),
            "Unknown effect type",
        )?;
        let max = if e.kind == "blur" { 100. } else { 3. };
        ensure(range(e.value, 0., max), "Invalid effect value")?;
        let mut times = HashSet::new();
        ensure(
            e.keys.len() <= 1000
                && e.keys.iter().all(|k| {
                    range(k.value, 0., max)
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
            "Invalid effect animation",
        )?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{read, save, Project};
    #[test]
    fn ordered_effects_roundtrip_and_validate() {
        let mut p: Project =
            serde_json::from_str(include_str!("../tests/fixtures/parenting-v4.supp")).unwrap();
        p.clips[0].effect_stack = vec![
            Effect {
                id: "contrast".into(),
                kind: "contrast".into(),
                enabled: true,
                value: 2.,
                keys: vec![],
            },
            Effect {
                id: "bright".into(),
                kind: "brightness".into(),
                enabled: false,
                value: 0.6,
                keys: vec![Keyframe {
                    frame: 0,
                    value: 0.2,
                    easing: "linear".into(),
                    in_handle: None,
                    out_handle: None,
                }],
            },
        ];
        p.validate().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("effects.supp");
        save(&file, &p).unwrap();
        let q = read(&file).unwrap();
        assert_eq!(q.schema_version, 8);
        assert_eq!(q.clips[0].effect_stack[1].keys[0].value, 0.2);
        p.clips[0].effect_stack[1].id = "contrast".into();
        assert!(p.validate().is_err());
        p.clips[0].effect_stack.pop();
        p.clips[0].effect_stack[0].value = 3.1;
        assert!(p.validate().is_err());
        p.clips[0].effect_stack[0].value = 1.;
        p.clips[0].kind = "null".into();
        assert!(p.validate().is_err());
    }
}
