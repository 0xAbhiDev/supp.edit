use crate::{ensure, range, unique, Error, Keyframe};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Treatment {
    pub clip_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain_keys: Option<Vec<Keyframe>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_keys: Option<Vec<Keyframe>>,
    pub time_remap: Option<crate::time_remap::TimeRemap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effects: Option<Vec<crate::effect_stack::Effect>>,
}
pub fn validate(values: &[Treatment]) -> Result<(), Error> {
    ensure(
        values.len() <= 512 && unique(values.iter().map(|t| t.clip_id.as_str())),
        "Invalid generated treatment IDs",
    )?;
    for t in values {
        ensure(
            t.gain.is_none_or(|v| range(v, -60., 12.))
                && t.scale.is_none_or(|v| range(v, 0.01, 10.)),
            "Invalid generated base values",
        )?;
        for keys in [&t.gain_keys, &t.scale_keys].into_iter().flatten() {
            let mut times = std::collections::HashSet::new();
            ensure(
                keys.len() <= 10000
                    && keys.iter().all(|k| {
                        k.frame.abs() <= 2_000_000_000
                            && range(k.value, -100000., 100000.)
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
                "Invalid generated keys",
            )?;
        }
        if let Some(curve) = &t.time_remap {
            curve.validate()?;
        }
        if let Some(effects) = &t.effects {
            crate::effect_stack::validate(effects, true)?;
        }
    }
    Ok(())
}
