use super::{ensure, range, unique, Error, Keyframe};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrainParameters {
    pub size: f64,
    pub softness: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurveParameters {
    pub red: Vec<[f64; 2]>,
    pub green: Vec<[f64; 2]>,
    pub blue: Vec<[f64; 2]>,
}
/// Grain and tone-curve effects carry different parameter shapes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EffectParameters {
    Grain(GrainParameters),
    Curves(CurveParameters),
}
fn valid_curve(points: &[[f64; 2]]) -> bool {
    (2..=8).contains(&points.len())
        && points.iter().all(|p| range(p[0], 0., 1.) && range(p[1], 0., 1.))
        && points.windows(2).all(|w| w[0][0] < w[1][0])
}
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<EffectParameters>,
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
            [
                "blur",
                "brightness",
                "contrast",
                "saturation",
                "tonalContrast",
                "temperature",
                "grain",
                "vignette",
                "sharpen",
                "curves",
            ]
            .contains(&e.kind.as_str()),
            "Unknown effect type",
        )?;
        let (min, max) = match e.kind.as_str() {
            "blur" => (0., 100.),
            "grain" => (0., 0.2),
            "vignette" => (0., 0.8),
            "sharpen" | "curves" => (0., 1.),
            "temperature" => (-1., 1.),
            "tonalContrast" => (0.5, 1.5),
            "saturation" => (0., 8.),
            _ => (0., 3.),
        };
        ensure(range(e.value, min, max), "Invalid effect value")?;
        match &e.parameters {
            Some(EffectParameters::Grain(p)) => ensure(
                e.kind == "grain" && range(p.size, 0.5, 8.) && range(p.softness, 0., 1.),
                "Invalid grain parameters",
            )?,
            Some(EffectParameters::Curves(c)) => ensure(
                e.kind == "curves"
                    && valid_curve(&c.red)
                    && valid_curve(&c.green)
                    && valid_curve(&c.blue),
                "Invalid tone curve",
            )?,
            None => ensure(e.kind != "curves", "A tone curve needs its curve points")?,
        }
        let mut times = HashSet::new();
        ensure(
            e.keys.len() <= 1000
                && e.keys.iter().all(|k| {
                    range(k.value, min, max)
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
    #[test]
    fn tone_curves_require_ordered_points_and_their_own_parameters() {
        let curve = |red: serde_json::Value| -> Vec<Effect> {
            serde_json::from_value(serde_json::json!([{
                "id": "tone", "type": "curves", "enabled": true, "value": 1.0,
                "parameters": {"red": red, "green": [[0.0, 0.0], [1.0, 1.0]], "blue": [[0.0, 0.05], [0.5, 0.4], [1.0, 0.9]]}
            }]))
            .unwrap()
        };
        assert!(validate(&curve(serde_json::json!([[0.0, 0.02], [0.3, 0.1], [1.0, 0.6]])), true).is_ok());
        assert!(validate(&curve(serde_json::json!([[0.5, 0.2], [0.3, 0.1]])), true).is_err());
        assert!(validate(&curve(serde_json::json!([[0.0, 1.5], [1.0, 1.0]])), true).is_err());
        let missing: Vec<Effect> = serde_json::from_value(serde_json::json!([
            {"id": "tone", "type": "curves", "enabled": true, "value": 1.0}
        ]))
        .unwrap();
        assert!(validate(&missing, true).is_err());
        let grain_on_curve: Vec<Effect> = serde_json::from_value(serde_json::json!([
            {"id": "tone", "type": "curves", "enabled": true, "value": 1.0, "parameters": {"size": 1.0, "softness": 0.5}}
        ]))
        .unwrap();
        assert!(validate(&grain_on_curve, true).is_err());
    }
    use crate::{read, save, Project};
    #[test]
    fn finishing_effects_preserve_parameters_and_reject_invalid_ranges() {
        let mut p: Project =
            serde_json::from_str(include_str!("../tests/fixtures/parenting-v4.supp")).unwrap();
        p.schema_version = 10;
        p.clips[0].effect_stack=serde_json::from_value(serde_json::json!([
            {"id":"tone","type":"tonalContrast","enabled":true,"value":1.09},
            {"id":"temp","type":"temperature","enabled":true,"value":-0.2},
            {"id":"grain","type":"grain","enabled":true,"value":0.025,"parameters":{"size":2.4,"softness":0.75}},
            {"id":"vignette","type":"vignette","enabled":true,"value":0.12},
            {"id":"sharp","type":"sharpen","enabled":true,"value":0.08}
        ])).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("finish.supp");
        save(&file, &p).unwrap();
        assert_eq!(
            serde_json::to_value(read(&file).unwrap()).unwrap(),
            serde_json::to_value(&p).unwrap()
        );
        if let Some(EffectParameters::Grain(g)) = p.clips[0].effect_stack[2].parameters.as_mut() {
            g.size = 0.;
        }
        assert!(p.validate().is_err());
        if let Some(EffectParameters::Grain(g)) = p.clips[0].effect_stack[2].parameters.as_mut() {
            g.size = 2.4;
        }
        p.clips[0].effect_stack[2].value = 0.3;
        assert!(p.validate().is_err());
    }
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
                parameters: None,
            },
            Effect {
                id: "bright".into(),
                kind: "brightness".into(),
                enabled: false,
                value: 0.6,
                parameters: None,
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
        assert_eq!(q.schema_version, 10);
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
