//! Analytic positive speed curves. Frame units belong to the containing sequence.
use crate::{ensure, range, Clip, Error};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeedKey {
    pub frame: i64,
    pub speed: f64,
    pub easing: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimeRemap {
    pub source_offset: f64,
    pub keys: Vec<SpeedKey>,
}
impl TimeRemap {
    pub fn validate(&self) -> Result<(), Error> {
        ensure(
            range(self.source_offset, 0., 1.)
                && self.source_offset < 1.
                && !self.keys.is_empty()
                && self.keys.len() <= 128
                && self.keys.iter().enumerate().all(|(i, k)| {
                    (-2_000_000_000..=2_000_000_000).contains(&k.frame)
                        && range(k.speed, 0.25, 4.)
                        && ["linear", "smooth"].contains(&k.easing.as_str())
                        && (i == 0 || k.frame > self.keys[i - 1].frame)
                }),
            "Invalid time remapping",
        )
    }
    fn primitive(&self, time: f64) -> f64 {
        let first = &self.keys[0];
        if time <= first.frame as f64 {
            return (time - first.frame as f64) * first.speed;
        }
        let mut total = 0.;
        for pair in self.keys.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            let width = (b.frame - a.frame) as f64;
            let u = ((time - a.frame as f64) / width).min(1.);
            let area = if a.easing == "smooth" {
                u * u * u - 0.5 * u * u * u * u
            } else {
                u * u / 2.
            };
            total += width * (a.speed * u + (b.speed - a.speed) * area);
            if time <= b.frame as f64 {
                return total;
            }
        }
        let last = self.keys.last().unwrap();
        total + (time - last.frame as f64) * last.speed
    }
    pub fn offset_at(&self, time: f64) -> f64 {
        self.source_offset + self.primitive(time) - self.primitive(0.)
    }
}
impl Clip {
    pub fn source_frame(&self, local_frame: f64) -> f64 {
        self.source_in as f64
            + self
                .time_remap
                .as_ref()
                .map_or(local_frame, |m| m.offset_at(local_frame))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn speed_curve_survives_native_save_reopen_and_checks_source_bounds() {
        let mut p: crate::Project =
            serde_json::from_str(include_str!("../tests/fixtures/compositor-v3.supp")).unwrap();
        p.schema_version = 10;
        let clip = p
            .compositions
            .iter_mut()
            .flat_map(|c| c.layers.iter_mut())
            .find(|c| c.kind == "media")
            .unwrap();
        clip.time_remap=Some(serde_json::from_value(serde_json::json!({"sourceOffset":0.25,"keys":[{"frame":0,"speed":1.2,"easing":"smooth"},{"frame":30,"speed":0.65,"easing":"smooth"},{"frame":60,"speed":1.2,"easing":"smooth"}]})).unwrap());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ramp.supp");
        crate::save(&path, &p).unwrap();
        let read = crate::read(&path).unwrap();
        assert_eq!(
            serde_json::to_value(&read).unwrap(),
            serde_json::to_value(&p).unwrap()
        );
        let clip = p
            .compositions
            .iter_mut()
            .flat_map(|c| c.layers.iter_mut())
            .find(|c| c.kind == "media")
            .unwrap();
        clip.source_in = 9999;
        assert!(p.validate().is_err());
    }
    #[test]
    fn analytic_curve_matches_frontend_contract_and_rejects_unsafe_keys() {
        let mut m = TimeRemap {
            source_offset: 0.25,
            keys: vec![
                SpeedKey {
                    frame: 0,
                    speed: 2.,
                    easing: "smooth".into(),
                },
                SpeedKey {
                    frame: 60,
                    speed: 0.5,
                    easing: "smooth".into(),
                },
                SpeedKey {
                    frame: 120,
                    speed: 2.,
                    easing: "smooth".into(),
                },
            ],
        };
        m.validate().unwrap();
        for (time, expected) in [
            (0., 0.25),
            (30., 51.8125),
            (60., 75.25),
            (90., 98.6875),
            (120., 150.25),
            (150., 210.25),
        ] {
            assert!((m.offset_at(time) - expected).abs() < 1e-8);
        }
        m.keys[1].speed = 0.;
        assert!(m.validate().is_err());
        m.keys[1].speed = 0.5;
        m.keys[1].frame = 0;
        assert!(m.validate().is_err());
    }
}
